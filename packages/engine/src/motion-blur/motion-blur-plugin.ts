import type { Entity } from '@retro-engine/ecs';

import { Camera } from '../camera/camera';
import { SortedCameras } from '../camera/sorted-cameras';
import type { App } from '../index';
import type { PluginObject } from '../plugin';
import { ViewPrepassTargets } from '../prepass/view-prepass-targets';
import { Core3dLabel } from '../render-graph/core-3d';
import { RenderGraph } from '../render-graph/render-graph';
import { TransparentPass3dLabel } from '../render-graph/transparent-pass-3d-node';
import { RenderSet } from '../render-set';
import { ShaderRegistry } from '../shader/shader-registry';
import { Extract, Query, ResMut } from '../system-param';
import { TonemappingPass3dLabel } from '../tonemapping/tonemapping-node';

import { MotionBlur } from './motion-blur';
import { makeMotionBlurNode, MotionBlurPass3dLabel } from './motion-blur-node';
import { MotionBlurPipeline } from './motion-blur-pipeline';
import { MOTION_BLUR_WGSL } from './motion-blur.wgsl';
import { ViewMotionBlur } from './view-motion-blur';
import {
  MOTION_BLUR_PARAMS_BYTE_SIZE,
  ViewMotionBlurTargets,
  evictMotionBlurTarget,
  resolveMotionBlurTarget,
} from './view-motion-blur-targets';

/**
 * Engine-internal plugin wiring the per-camera screen-space motion-blur pass.
 *
 * Auto-installed by `CorePlugin` after `TonemappingPlugin` (so its `finish`
 * runs after the tonemap node exists and can be ordered behind motion blur).
 *
 * On `build` it registers the `retro_engine::motion_blur` WGSL, inserts the
 * pipeline + extract-target + output-target resources, and registers the
 * extract and prepare systems. On `finish` it inserts the motion-blur node
 * into Core3d ordered `Transparent → MotionBlur → Tonemapping`.
 *
 * Motion blur is HDR-space: it reads the camera's HDR scene intermediate and
 * writes a blurred copy that the tonemap pass then consumes. It requires both
 * `Camera.hdr = true` and a `MotionVectorPrepass` on the camera; when either is
 * missing the prepare system skips allocation (warning once) and the node
 * short-circuits, so the camera renders un-blurred rather than failing.
 */
export class MotionBlurPlugin implements PluginObject {
  name(): string {
    return 'MotionBlurPlugin';
  }

  build(app: App): void {
    const registry = app.getResource(ShaderRegistry);
    if (registry === undefined) {
      throw new Error(
        'MotionBlurPlugin: ShaderRegistry resource missing; ShaderPlugin must run before MotionBlurPlugin.',
      );
    }
    (registry as ShaderRegistry).register('retro_engine::motion_blur', MOTION_BLUR_WGSL);

    if (app.getResource(MotionBlurPipeline) === undefined) {
      app.insertResource(new MotionBlurPipeline());
    }
    if (app.getResource(ViewMotionBlur) === undefined) {
      app.insertResource(new ViewMotionBlur());
    }
    if (app.getResource(ViewMotionBlurTargets) === undefined) {
      app.insertResource(new ViewMotionBlurTargets());
    }

    app.addSystem(
      'render',
      [Extract(Query([Camera, MotionBlur])), ResMut(ViewMotionBlur)],
      (q, viewMb) => {
        viewMb.byCamera.clear();
        for (const [entity, camera, mb] of q.entries()) {
          if (!camera.isActive) continue;
          viewMb.byCamera.set(entity, {
            samples: mb.samples,
            velocityScale: mb.intensity * mb.shutterAngle,
            maxVelocity: mb.maxVelocity,
          });
        }
      },
      { set: RenderSet.Extract, label: 'motion-blur-extract' },
    );

    const log = app.logger.child('motion-blur');
    const warnedMissing = new Set<Entity>();
    const scratch = new ArrayBuffer(MOTION_BLUR_PARAMS_BYTE_SIZE);
    const scratchView = new DataView(scratch);

    app.addSystem(
      'render',
      [ResMut(ViewMotionBlur), ResMut(ViewMotionBlurTargets), ResMut(SortedCameras)],
      (viewMb, targets, sorted) => {
        const prepass = app.getResource(ViewPrepassTargets);
        const live = new Set<Entity>();
        for (const view of sorted.views) {
          const entity = view.sourceEntity as Entity;
          const params = viewMb.byCamera.get(entity);
          if (params === undefined) continue;
          if (!view.hdr) {
            if (!warnedMissing.has(entity)) {
              warnedMissing.add(entity);
              log.devWarn(
                `camera (source entity ${view.sourceEntity}) has MotionBlur but Camera.hdr = false — motion blur reads the HDR intermediate, so blur is skipped. Set hdr: true.`,
              );
            }
            continue;
          }
          const motionView = prepass?.perCamera.get(entity)?.motionView;
          if (motionView === undefined) {
            if (!warnedMissing.has(entity)) {
              warnedMissing.add(entity);
              log.devWarn(
                `camera (source entity ${view.sourceEntity}) has MotionBlur but no motion-vector target — add a MotionVectorPrepass component so motion vectors exist; blur skipped.`,
              );
            }
            continue;
          }
          live.add(entity);
          resolveMotionBlurTarget(targets, app, entity, view.mainColorTarget);
          const entry = targets.perCamera.get(entity)!;
          scratchView.setUint32(0, params.samples >>> 0, true);
          scratchView.setFloat32(4, params.velocityScale, true);
          scratchView.setFloat32(8, params.maxVelocity, true);
          scratchView.setFloat32(12, 0, true);
          app.renderer.writeBuffer(entry.paramsBuffer, 0, scratch as BufferSource);
        }
        const pipeline = app.getResource(MotionBlurPipeline);
        for (const entity of targets.perCamera.keys()) {
          if (!live.has(entity)) {
            evictMotionBlurTarget(targets, entity);
            // Drop the cached bind group too — it references the params buffer
            // and output view we just destroyed.
            pipeline?.invalidate(entity);
          }
        }
      },
      { set: RenderSet.Prepare, label: 'motion-blur-prepare', after: ['prepass-prepare-targets'] },
    );
  }

  finish(app: App): void {
    const graph = app.getResource(RenderGraph);
    if (graph === undefined) {
      throw new Error(
        'MotionBlurPlugin: RenderGraph resource missing at finish(); RenderGraphPlugin must have built before MotionBlurPlugin.',
      );
    }
    const sub3d = graph.getSubGraph(Core3dLabel);
    if (sub3d === undefined) {
      throw new Error(
        'MotionBlurPlugin: Core3d sub-graph missing at finish(); RenderGraphPlugin must have registered it.',
      );
    }
    sub3d.addNode(makeMotionBlurNode());
    sub3d.addEdge(TransparentPass3dLabel, MotionBlurPass3dLabel);
    // Force the tonemap pass to read motion blur's output: order it after the
    // blur node. The pre-existing Transparent → Tonemapping edge is redundant
    // but harmless once this stricter edge is in place.
    if (sub3d.hasNode(TonemappingPass3dLabel)) {
      sub3d.addEdge(MotionBlurPass3dLabel, TonemappingPass3dLabel);
    }
  }
}
