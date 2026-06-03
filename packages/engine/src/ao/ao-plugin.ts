import type { Entity } from '@retro-engine/ecs';
import { mat4 } from '@retro-engine/math';
import type { Mat4 } from '@retro-engine/math';

import { Camera } from '../camera/camera';
import { ViewJitter } from '../camera/jitter';
import { jitterProjection } from '../camera/jitter';
import { SortedCameras } from '../camera/sorted-cameras';
import type { App } from '../index';
import type { PluginObject } from '../plugin';
import { ViewPrepassTargets } from '../prepass/view-prepass-targets';
import { Core3dLabel } from '../render-graph/core-3d';
import { OpaquePass3dLabel } from '../render-graph/opaque-pass-3d-node';
import { PrepassNode3dLabel } from '../prepass/prepass-3d-node';
import { RenderGraph } from '../render-graph/render-graph';
import { RenderSet } from '../render-set';
import { ShaderRegistry } from '../shader/shader-registry';
import { Extract, Query, ResMut } from '../system-param';

import { t } from '@retro-engine/reflect';

import { ScreenSpaceAo } from './ao';
import { AoBindGroupCache } from './ao-bind-group-cache';
import { AoBlurPipeline } from './ao-blur-pipeline';
import {
  makeAoBlurNode,
  makeAoGtaoNode,
  makeAoTemporalNode,
  AoBlurPass3dLabel,
  AoGtaoPass3dLabel,
  AoTemporalPass3dLabel,
} from './ao-node';
import { AoPipeline } from './ao-pipeline';
import { AoTemporalPipeline } from './ao-temporal-pipeline';
import { AO_BLUR_WGSL, AO_GTAO_WGSL, AO_TEMPORAL_WGSL } from './ao.wgsl';
import { ViewAo } from './view-ao';
import {
  AO_PARAMS_BYTE_SIZE,
  evictAoTargets,
  resolveAoTargets,
  ViewAoTargets,
} from './view-ao-targets';

/**
 * Engine-internal plugin wiring the per-camera screen-space ambient-occlusion
 * pass.
 *
 * Auto-installed by `CorePlugin`. On `build` it registers the
 * `retro_engine::ao_gtao` WGSL, inserts the pipeline + extract-param +
 * output-target + read-binding resources, and registers the extract and prepare
 * systems. On `finish` it inserts the GTAO node into Core3d ordered
 * `Prepass → AO → Opaque`.
 *
 * AO runs before the opaque pass and feeds its result into the lit forward
 * shader's ambient term. It requires both a `DepthPrepass` and a `NormalPrepass`
 * on the camera; when either is missing the prepare system skips allocation
 * (warning once) and the node short-circuits, so the camera shades with a flat
 * ambient term rather than failing.
 */
export class AoPlugin implements PluginObject {
  name(): string {
    return 'AoPlugin';
  }

  build(app: App): void {
    const registry = app.getResource(ShaderRegistry);
    if (registry === undefined) {
      throw new Error(
        'AoPlugin: ShaderRegistry resource missing; ShaderPlugin must run before AoPlugin.',
      );
    }
    (registry as ShaderRegistry).register('retro_engine::ao_gtao', AO_GTAO_WGSL);
    (registry as ShaderRegistry).register('retro_engine::ao_blur', AO_BLUR_WGSL);
    (registry as ShaderRegistry).register('retro_engine::ao_temporal', AO_TEMPORAL_WGSL);

    app.registerComponent(
      ScreenSpaceAo,
      { radius: t.number, intensity: t.number, bias: t.number, slices: t.number, steps: t.number },
      { name: 'ScreenSpaceAo' },
    );

    if (app.getResource(AoPipeline) === undefined) app.insertResource(new AoPipeline());
    if (app.getResource(AoBlurPipeline) === undefined) app.insertResource(new AoBlurPipeline());
    if (app.getResource(AoTemporalPipeline) === undefined) {
      app.insertResource(new AoTemporalPipeline());
    }
    if (app.getResource(ViewAo) === undefined) app.insertResource(new ViewAo());
    if (app.getResource(ViewAoTargets) === undefined) app.insertResource(new ViewAoTargets());
    if (app.getResource(AoBindGroupCache) === undefined) {
      app.insertResource(new AoBindGroupCache());
    }

    app.addSystem(
      'render',
      [Extract(Query([Camera, ScreenSpaceAo])), ResMut(ViewAo)],
      (q, viewAo) => {
        viewAo.byCamera.clear();
        for (const [entity, camera, ao] of q.entries()) {
          if (!camera.isActive) continue;
          viewAo.byCamera.set(entity, {
            radius: ao.radius,
            intensity: ao.intensity,
            bias: ao.bias,
            slices: ao.slices,
            steps: ao.steps,
          });
        }
      },
      { set: RenderSet.Extract, label: 'ao-extract' },
    );

    const log = app.logger.child('ao');
    const warnedMissing = new Set<Entity>();
    const scratch = new ArrayBuffer(AO_PARAMS_BYTE_SIZE);
    const scratchF32 = new Float32Array(scratch);
    const jitteredProj = mat4.create() as Mat4;
    const invProj = mat4.create() as Mat4;
    const frame = { index: 0 };

    app.addSystem(
      'render',
      [ResMut(ViewAo), ResMut(ViewAoTargets), ResMut(SortedCameras)],
      (viewAo, targets, sorted) => {
        const prepass = app.getResource(ViewPrepassTargets);
        const jitter = app.getResource(ViewJitter);
        const bindCache = app.getResource(AoBindGroupCache)!;
        const live = new Set<Entity>();
        for (const view of sorted.views) {
          const entity = view.sourceEntity as Entity;
          const params = viewAo.byCamera.get(entity);
          if (params === undefined) continue;

          const entry = prepass?.perCamera.get(entity);
          if (entry === undefined || entry.normalView === undefined) {
            if (!warnedMissing.has(entity)) {
              warnedMissing.add(entity);
              log.devWarn(
                `camera (source entity ${view.sourceEntity}) has ScreenSpaceAo but no depth + normal prepass — add DepthPrepass and NormalPrepass components; AO skipped.`,
              );
            }
            continue;
          }
          live.add(entity);
          // Temporal accumulation needs the motion-vector prepass; without it
          // the camera falls back to blur-only (no history allocated).
          const temporal = entry.motionView !== undefined;
          const ao = resolveAoTargets(targets, app, entity, view.mainColorTarget, temporal);

          // Reconstruction uses the matrix the depth was actually rasterized
          // with: re-bake the same sub-pixel jitter the camera folded into
          // view_proj, then invert. With no jitter this is inverse(projection).
          const offset = jitter?.perCamera.get(entity);
          const vpW = view.viewport.physicalSize.width;
          const vpH = view.viewport.physicalSize.height;
          if (offset !== undefined && (offset.x !== 0 || offset.y !== 0)) {
            const ndcX = vpW > 0 ? (offset.x * 2) / vpW : 0;
            const ndcY = vpH > 0 ? (offset.y * 2) / vpH : 0;
            jitterProjection(view.projectionMatrix as Mat4, ndcX, ndcY, jitteredProj);
          } else {
            mat4.copy(view.projectionMatrix as Mat4, jitteredProj);
          }
          mat4.inverse(jitteredProj, invProj);

          const w = ao.width;
          const h = ao.height;
          scratchF32.set(invProj, 0);
          scratchF32.set(view.viewMatrix as Float32Array, 16);
          scratchF32[32] = w;
          scratchF32[33] = h;
          scratchF32[34] = w > 0 ? 1 / w : 0;
          scratchF32[35] = h > 0 ? 1 / h : 0;
          scratchF32[36] = params.radius;
          scratchF32[37] = params.intensity;
          scratchF32[38] = params.bias;
          // Perspective y focal length (projection[1][1], column-major index 5).
          scratchF32[39] = (view.projectionMatrix as Float32Array)[5] ?? 1;
          scratchF32[40] = params.slices;
          scratchF32[41] = params.steps;
          scratchF32[42] = frame.index;
          // _pad doubles as the temporal `reset` flag: 1 until history primes.
          let reset = 0;
          if (temporal && ao.historyViews !== undefined) {
            // Advance the ping-pong: write the slot not written last frame so the
            // slot just written becomes next frame's history (mirrors TAA).
            ao.current = (ao.current ^ 1) as 0 | 1;
            ao.finalView = ao.historyViews[ao.current];
            reset = ao.historyValid ? 0 : 1;
            ao.historyValid = true;
          }
          scratchF32[43] = reset;
          app.renderer.writeBuffer(ao.paramsBuffer, 0, scratch as BufferSource);

          // Build the @group(3) read binding the opaque pass samples. Resolving
          // it here keeps "AO target exists" and "AO read binding exists" in
          // lockstep — the opaque pipeline variant and setBindGroup(3) both gate
          // on the read binding's presence.
          bindCache.ensureInitialised(app);
          bindCache.resolve(app, entity, ao.finalView);
        }

        const pipeline = app.getResource(AoPipeline);
        const blurPipeline = app.getResource(AoBlurPipeline);
        const temporalPipeline = app.getResource(AoTemporalPipeline);
        for (const entity of targets.perCamera.keys()) {
          if (!live.has(entity)) {
            evictAoTargets(targets, entity);
            pipeline?.invalidate(entity);
            blurPipeline?.invalidate(entity);
            temporalPipeline?.invalidate(entity);
            bindCache.invalidate(entity);
          }
        }
        frame.index++;
      },
      { set: RenderSet.Prepare, label: 'ao-prepare', after: ['prepass-prepare-targets'] },
    );
  }

  finish(app: App): void {
    const graph = app.getResource(RenderGraph);
    if (graph === undefined) {
      throw new Error(
        'AoPlugin: RenderGraph resource missing at finish(); RenderGraphPlugin must have built before AoPlugin.',
      );
    }
    const sub3d = graph.getSubGraph(Core3dLabel);
    if (sub3d === undefined) {
      throw new Error(
        'AoPlugin: Core3d sub-graph missing at finish(); RenderGraphPlugin must have registered it.',
      );
    }
    sub3d.addNode(makeAoGtaoNode());
    sub3d.addNode(makeAoBlurNode());
    sub3d.addNode(makeAoTemporalNode());
    // AO reads the prepass and writes a target the opaque pass samples: order it
    // after the prepass and before the opaque pass, threading GTAO → blur →
    // temporal. The temporal node is a no-op when the camera has no motion-vector
    // target (blur stays final). The pre-existing Prepass → Opaque edge is
    // preserved; the topological sort threads AO between them.
    if (sub3d.hasNode(PrepassNode3dLabel)) {
      sub3d.addEdge(PrepassNode3dLabel, AoGtaoPass3dLabel);
    }
    sub3d.addEdge(AoGtaoPass3dLabel, AoBlurPass3dLabel);
    sub3d.addEdge(AoBlurPass3dLabel, AoTemporalPass3dLabel);
    sub3d.addEdge(AoTemporalPass3dLabel, OpaquePass3dLabel);
  }
}
