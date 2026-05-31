import type { Entity } from '@retro-engine/ecs';

import { Camera } from '../camera/camera';
import { ViewJitter } from '../camera/jitter';
import { SortedCameras } from '../camera/sorted-cameras';
import type { App } from '../index';
import { MotionBlurPass3dLabel } from '../motion-blur/motion-blur-node';
import type { PluginObject } from '../plugin';
import { ViewPrepassTargets } from '../prepass/view-prepass-targets';
import { Core3dLabel } from '../render-graph/core-3d';
import { RenderGraph } from '../render-graph/render-graph';
import { TransparentPass3dLabel } from '../render-graph/transparent-pass-3d-node';
import { RenderSet } from '../render-set';
import { ShaderRegistry } from '../shader/shader-registry';
import { Extract, Query, ResMut } from '../system-param';
import { TonemappingPass3dLabel } from '../tonemapping/tonemapping-node';

import { haltonJitter } from './halton';
import { Taa } from './taa';
import { makeTaaNode, TaaPass3dLabel } from './taa-node';
import { TaaPipeline } from './taa-pipeline';
import { TAA_WGSL } from './taa.wgsl';
import { ViewTaa } from './view-taa';
import {
  evictTaaTargets,
  resolveTaaTargets,
  TAA_PARAMS_BYTE_SIZE,
  ViewTaaTargets,
} from './view-taa-targets';

/**
 * Engine-internal plugin wiring the per-camera temporal anti-aliasing resolve.
 *
 * Auto-installed by `CorePlugin` after `MotionBlurPlugin` (so its `finish` can
 * order the resolve ahead of the blur and tonemap nodes already registered).
 *
 * On `build` it registers the `retro_engine::taa` WGSL, inserts the pipeline +
 * extract-param + history-target resources, and registers the extract and
 * prepare systems. The extract system also generates the sub-pixel Halton
 * jitter offset for each TAA camera and publishes it into the camera plugin's
 * `ViewJitter` resource, which bakes it into `view_proj` (leaving
 * `unjittered_view_proj`, and hence motion vectors, clean). On `finish` it
 * inserts the resolve node into Core3d ordered `Transparent → TAA →
 * MotionBlur → Tonemapping`.
 *
 * TAA is HDR-space: it reads the camera's HDR scene intermediate and writes a
 * resolved copy that the rest of the post chain consumes. It requires both
 * `Camera.hdr = true` and a `MotionVectorPrepass` on the camera; when either is
 * missing the prepare system skips allocation (warning once) and the node
 * short-circuits, so the camera renders without temporal AA rather than failing.
 */
export class TaaPlugin implements PluginObject {
  name(): string {
    return 'TaaPlugin';
  }

  build(app: App): void {
    const registry = app.getResource(ShaderRegistry);
    if (registry === undefined) {
      throw new Error(
        'TaaPlugin: ShaderRegistry resource missing; ShaderPlugin must run before TaaPlugin.',
      );
    }
    (registry as ShaderRegistry).register('retro_engine::taa', TAA_WGSL);

    if (app.getResource(TaaPipeline) === undefined) {
      app.insertResource(new TaaPipeline());
    }
    if (app.getResource(ViewTaa) === undefined) {
      app.insertResource(new ViewTaa());
    }
    if (app.getResource(ViewTaaTargets) === undefined) {
      app.insertResource(new ViewTaaTargets());
    }

    // One shared jitter index advanced once per frame; all TAA cameras sample
    // the same point in the sequence, which is fine — they jitter independently
    // of one another's geometry.
    const frame = { index: 0 };

    app.addSystem(
      'render',
      [Extract(Query([Camera, Taa])), ResMut(ViewJitter), ResMut(ViewTaa)],
      (q, jitter, viewTaa) => {
        jitter.perCamera.clear();
        viewTaa.byCamera.clear();
        const offset = haltonJitter(frame.index);
        for (const [entity, camera, taa] of q.entries()) {
          if (!camera.isActive) continue;
          jitter.perCamera.set(entity, offset);
          viewTaa.byCamera.set(entity, { blend: taa.blend });
        }
        frame.index++;
      },
      { set: RenderSet.Extract, label: 'taa-extract' },
    );

    const log = app.logger.child('taa');
    const warnedMissing = new Set<Entity>();
    const scratch = new ArrayBuffer(TAA_PARAMS_BYTE_SIZE);
    const scratchView = new DataView(scratch);

    app.addSystem(
      'render',
      [ResMut(ViewTaa), ResMut(ViewTaaTargets), ResMut(SortedCameras)],
      (viewTaa, targets, sorted) => {
        const prepass = app.getResource(ViewPrepassTargets);
        const live = new Set<Entity>();
        for (const view of sorted.views) {
          const entity = view.sourceEntity as Entity;
          const params = viewTaa.byCamera.get(entity);
          if (params === undefined) continue;
          if (!view.hdr) {
            if (!warnedMissing.has(entity)) {
              warnedMissing.add(entity);
              log.devWarn(
                `camera (source entity ${view.sourceEntity}) has Taa but Camera.hdr = false — TAA resolves the HDR intermediate, so it is skipped. Set hdr: true.`,
              );
            }
            continue;
          }
          const motionView = prepass?.perCamera.get(entity)?.motionView;
          if (motionView === undefined) {
            if (!warnedMissing.has(entity)) {
              warnedMissing.add(entity);
              log.devWarn(
                `camera (source entity ${view.sourceEntity}) has Taa but no motion-vector target — add a MotionVectorPrepass component so motion vectors exist; TAA skipped.`,
              );
            }
            continue;
          }
          live.add(entity);
          const entry = resolveTaaTargets(targets, app, entity, view.mainColorTarget);
          // Advance the ping-pong: write the slot we did not write last frame so
          // the slot just resolved becomes next frame's history.
          entry.current = (entry.current ^ 1) as 0 | 1;
          scratchView.setFloat32(0, params.blend, true);
          scratchView.setUint32(4, entry.valid ? 0 : 1, true);
          scratchView.setFloat32(8, 0, true);
          scratchView.setFloat32(12, 0, true);
          app.renderer.writeBuffer(entry.paramsBuffer, 0, scratch as BufferSource);
        }
        const pipeline = app.getResource(TaaPipeline);
        for (const entity of targets.perCamera.keys()) {
          if (!live.has(entity)) {
            evictTaaTargets(targets, entity);
            pipeline?.invalidate(entity);
          }
        }
      },
      { set: RenderSet.Prepare, label: 'taa-prepare', after: ['prepass-prepare-targets'] },
    );
  }

  finish(app: App): void {
    const graph = app.getResource(RenderGraph);
    if (graph === undefined) {
      throw new Error(
        'TaaPlugin: RenderGraph resource missing at finish(); RenderGraphPlugin must have built before TaaPlugin.',
      );
    }
    const sub3d = graph.getSubGraph(Core3dLabel);
    if (sub3d === undefined) {
      throw new Error(
        'TaaPlugin: Core3d sub-graph missing at finish(); RenderGraphPlugin must have registered it.',
      );
    }
    sub3d.addNode(makeTaaNode());
    sub3d.addEdge(TransparentPass3dLabel, TaaPass3dLabel);
    // Order TAA ahead of motion blur so the blur smears the resolved scene, and
    // ahead of tonemapping so a TAA-only camera still tonemaps the resolved
    // result. Both downstream nodes read TAA's output via the CurrentHdrView
    // handoff.
    if (sub3d.hasNode(MotionBlurPass3dLabel)) {
      sub3d.addEdge(TaaPass3dLabel, MotionBlurPass3dLabel);
    }
    if (sub3d.hasNode(TonemappingPass3dLabel)) {
      sub3d.addEdge(TaaPass3dLabel, TonemappingPass3dLabel);
    }
  }
}
