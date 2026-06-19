import type { Entity } from '@retro-engine/ecs';

import { Camera } from '../camera/camera';
import { ExtractedCamera } from '../camera/extracted';
import { SortedCameras } from '../camera/sorted-cameras';
import type { App } from '../index';
import type { Logger } from '../log';
import { Mesh3d } from '../mesh';
import type { PluginObject } from '../plugin';
import { Core3dLabel } from '../render-graph/core-3d';
import { OpaquePass3dLabel } from '../render-graph/opaque-pass-3d-node';
import { RenderGraph } from '../render-graph/render-graph';
import { Shadow3dPass3dLabel } from '../render-graph/shadow-pass-3d-node';
import { RenderSet } from '../render-set';
import { ShaderRegistry } from '../shader/shader-registry';
import { Extract, Query, ResMut } from '../system-param';
import { GlobalTransform } from '../transform';

import { PrepassNode3d, PrepassNode3dLabel } from './prepass-3d-node';
import { PREPASS_WGSL } from './prepass.wgsl';

import {
  DepthPrepass,
  intersectPrepassFlags,
  MotionVectorPrepass,
  NormalPrepass,
  prepassFlagsAny,
  PREPASS_FLAGS_NONE,
  type PrepassFlags,
} from './components';
import { PreviousGlobalTransform } from './previous-global-transform';
import {
  evictCameraPrepassTargets,
  resolveCameraPrepassTargets,
  ViewPrepassTargets,
} from './view-prepass-targets';

/**
 * Per-frame map of main-world camera entity → its enabled prepass flags.
 * Populated by `PrepassPlugin`'s Extract system from the three marker
 * components ({@link DepthPrepass}, {@link NormalPrepass},
 * {@link MotionVectorPrepass}), consumed by the Prepare system that allocates
 * the per-camera prepass textures.
 *
 * Cleared and refilled each frame — do not retain references across frames.
 *
 * @internal
 */
export class PrepassFlagsByCamera {
  readonly map: Map<Entity, PrepassFlags> = new Map();
}

/**
 * Engine plugin enabling the screen-space prepass family. Per-camera, opt-in
 * via three marker components on the camera entity:
 *
 * - {@link DepthPrepass} — depth-only pre-render.
 * - {@link NormalPrepass} — world-space normals + roughness into an
 *   `rgba16float` color target.
 * - {@link MotionVectorPrepass} — NDC motion vectors into an `rg16float`
 *   color target; requires the entity's previous-frame world matrix, which
 *   the plugin maintains via {@link PreviousGlobalTransform}.
 *
 * The plugin inserts {@link ViewPrepassTargets}, {@link PrepassFlagsByCamera},
 * registers the per-frame propagation system that advances
 * `PreviousGlobalTransform` in `'last'`, and (in a later step) wires the
 * `PrepassNode3d` into the Core3d sub-graph between the shadow pass and the
 * opaque pass.
 *
 * Requires `RenderGraphPlugin` (for the Core3d sub-graph) and
 * `CameraPlugin` (for the camera Extract/Prepare cycle). Plugin order vs
 * `Light3dPlugin` is flexible — the sub-graph wiring uses `hasNode` to
 * defensively detect the shadow node.
 */
export class PrepassPlugin implements PluginObject {
  name(): string {
    return 'PrepassPlugin';
  }

  category(): 'engine' {
    return 'engine';
  }

  build(app: App): void {
    if (app.getResource(ViewPrepassTargets) === undefined) {
      app.insertResource(new ViewPrepassTargets());
    }
    if (app.getResource(PrepassFlagsByCamera) === undefined) {
      app.insertResource(new PrepassFlagsByCamera());
    }
    const registry = app.getResource(ShaderRegistry);
    if (registry !== undefined && !registry.has('retro_engine::prepass')) {
      registry.register('retro_engine::prepass', PREPASS_WGSL);
    }

    // Authored per-camera opt-in markers — no fields, but they persist so a saved
    // camera keeps its prepass selection on load.
    app.registerComponent(DepthPrepass, {}, { name: 'DepthPrepass' });
    app.registerComponent(NormalPrepass, {}, { name: 'NormalPrepass' });
    app.registerComponent(MotionVectorPrepass, {}, { name: 'MotionVectorPrepass' });

    const graph = app.getResource(RenderGraph);
    if (graph === undefined) {
      throw new Error(
        'PrepassPlugin: RenderGraph resource missing; RenderGraphPlugin must run before PrepassPlugin.',
      );
    }
    const sub = graph.getSubGraph(Core3dLabel);
    if (sub === undefined) {
      throw new Error(
        'PrepassPlugin: Core3d sub-graph missing; RenderGraphPlugin must build the sub-graph before PrepassPlugin.',
      );
    }
    sub.addNode(PrepassNode3d);
    if (sub.hasNode(Shadow3dPass3dLabel)) {
      sub.addEdge(Shadow3dPass3dLabel, PrepassNode3dLabel);
    }
    sub.addEdge(PrepassNode3dLabel, OpaquePass3dLabel);

    const log: Logger = app.logger.child('prepass');
    const warnedNoDepth = new Set<Entity>();

    // Mesh3d insert hook: auto-attach PreviousGlobalTransform to every new
    // 3D renderable, seeded from the entity's current GlobalTransform so the
    // first rendered frame produces a zero motion vector.
    app.registerComponentHook(Mesh3d, 'onInsert', (ctx) => {
      if (ctx.world.getComponent(ctx.entity, PreviousGlobalTransform) !== undefined) return;
      const prev = new PreviousGlobalTransform();
      const gt = ctx.world.getComponent(ctx.entity, GlobalTransform);
      if (gt !== undefined) {
        (prev.matrix as Float32Array).set(gt.matrix as Float32Array);
      }
      ctx.commands.entity(ctx.entity).insert(prev);
    });

    // 'first': snapshot the previous frame's final GlobalTransform into
    // PreviousGlobalTransform BEFORE this frame's transform propagation
    // overwrites GlobalTransform. By the time `'first'` runs, the main
    // schedule has cycled past last frame's `'last'` and not yet entered
    // this frame's `'postUpdate'`, so `GlobalTransform.matrix` still holds
    // last frame's value — the lag motion-vector reconstruction needs.
    //
    // First-frame behaviour: entities freshly inserted in `'startup'`
    // gain PreviousGlobalTransform via the Mesh3d hook (seeded from
    // GlobalTransform at that moment, which is identity until the first
    // postUpdate). On their first rendered frame, PreviousGlobalTransform
    // therefore holds identity while GlobalTransform holds the propagated
    // matrix — motion vectors on frame 1 reflect a one-frame fade-in.
    // Downstream temporal effects (TAA) clip history on the first frame
    // anyway, so this is tolerated.
    app.addSystem(
      'first',
      [Query([GlobalTransform, PreviousGlobalTransform])],
      (q) => {
        for (const [, gt, prev] of q.entries()) {
          (prev.matrix as Float32Array).set(gt.matrix as Float32Array);
        }
      },
      { label: 'previous-transform-propagate' },
    );

    // Extract: collect per-camera prepass flags from the three marker
    // components into PrepassFlagsByCamera. Reads main-world via `app.world`
    // because the markers live on the main-world camera entity.
    app.addSystem(
      'render',
      [Extract(Query([Camera])), ResMut(PrepassFlagsByCamera)],
      (cameras, flagsByCamera) => {
        flagsByCamera.map.clear();
        for (const [entity, camera] of cameras.entries()) {
          if (!camera.isActive) continue;
          const flags: PrepassFlags = {
            depth: app.world.getComponent(entity, DepthPrepass) !== undefined,
            normal: app.world.getComponent(entity, NormalPrepass) !== undefined,
            motionVector:
              app.world.getComponent(entity, MotionVectorPrepass) !== undefined,
          };
          if (prepassFlagsAny(flags)) {
            flagsByCamera.map.set(entity, flags);
          }
        }
      },
      { set: RenderSet.Extract, label: 'prepass-extract-flags' },
    );

    // Prepare: allocate / reuse / GC per-camera prepass color targets after
    // the camera plugin has resolved depth attachments and built
    // SortedCameras for this frame.
    app.addSystem(
      'render',
      [
        Query([ExtractedCamera]),
        ResMut(PrepassFlagsByCamera),
        ResMut(ViewPrepassTargets),
        ResMut(SortedCameras),
      ],
      (extractedQ, flagsByCamera, targets, sorted) => {
        const live = new Set<Entity>();
        for (const view of sorted.views) {
          const sourceEntity = view.sourceEntity as Entity;
          const flags = flagsByCamera.map.get(sourceEntity);
          if (flags === undefined) continue;
          if (view.depth === undefined) {
            if (!warnedNoDepth.has(sourceEntity)) {
              warnedNoDepth.add(sourceEntity);
              log.devWarn(
                `camera (source entity ${view.sourceEntity}) has a prepass marker but depthTarget: 'none' — prepass skipped. Use 'auto' (default) or 'manual'.`,
              );
            }
            continue;
          }
          live.add(sourceEntity);
          // `view.depth` is `{ view, format }` only — promote to a full
          // ResolvedRenderTarget by borrowing the main color target's
          // dimensions (the depth texture is allocated to match).
          const depth = {
            view: view.depth.view,
            format: view.depth.format,
            width: view.mainColorTarget.width,
            height: view.mainColorTarget.height,
          };
          resolveCameraPrepassTargets(targets, app, sourceEntity, flags, depth);
        }
        // GC entries for cameras absent from this frame's live set. Collect
        // keys into a scratch array first so the evict path can mutate the
        // underlying Map without invalidating an in-flight iterator.
        const toEvict: Entity[] = [];
        for (const entity of targets.perCamera.keys()) {
          if (!live.has(entity)) toEvict.push(entity);
        }
        for (const entity of toEvict) evictCameraPrepassTargets(targets, entity);
        // Suppress the unused-param lint for `extractedQ` — it gates this
        // system on at least one extracted camera being present, which keeps
        // the system from running before CameraPlugin's prepare.
        void extractedQ;
      },
      { set: RenderSet.Prepare, label: 'prepass-prepare-targets', after: ['camera-prepare'] },
    );
  }
}

// Re-export of the intersect helper so plugin consumers (e.g. material queue
// systems) don't need a separate import path.
export { intersectPrepassFlags, PREPASS_FLAGS_NONE };
