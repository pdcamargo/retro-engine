import { SortedCameras } from '../camera/sorted-cameras';

import type { Node, NodeRunContext } from './node';
import { createLabel } from './render-label';

/**
 * Label for the top-level {@link Node} that drives per-camera rendering.
 * Registered as the single root node on the {@link RenderGraph} by
 * `RenderGraphPlugin`.
 */
export const CameraDriverLabel = createLabel('camera_driver');

/**
 * Root {@link Node}: iterates the per-frame {@link SortedCameras} list,
 * creates one command encoder for the whole frame, dispatches each camera's
 * sub-graph (`Core2d` / `Core3d` by default) with the camera view threaded
 * through `ctx.view`, and submits the encoder.
 *
 * Mirrors the body of the pre-Phase-5 `App.renderFrame()` per-camera loop
 * (`for (view of sorted.views) { open-pass; run Render set; end-pass; } submit`),
 * lifted out of `App` into a graph node so post-process / prepass nodes can
 * live inside the sub-graphs in later phases.
 *
 * Stateless singleton; safe to reference from multiple graphs.
 */
export const CameraDriverNode: Node = {
  label: CameraDriverLabel,
  input: (): readonly never[] => [],
  output: (): readonly never[] => [],
  run(ctx: NodeRunContext): void {
    const sorted = ctx.app.getResource(SortedCameras);
    const views = sorted?.views ?? [];
    if (views.length === 0) return;
    const encoder = ctx.app.renderer.createCommandEncoder('frame');
    const warned = new Set<string>();
    for (const view of views) {
      const sub = ctx.graph.getSubGraph(view.subGraph);
      if (sub === undefined) {
        const key = String(view.subGraph);
        if (!warned.has(key)) {
          ctx.app.logger
            .child('render-graph')
            .devWarn(
              `camera (source entity ${view.sourceEntity}) requested sub-graph ${key} but no sub-graph is registered — skipping`,
            );
          warned.add(key);
        }
        continue;
      }
      const childCtx: NodeRunContext = {
        app: ctx.app,
        graph: ctx.graph,
        encoder,
        pass: undefined,
        view,
        renderSetSystems: ctx.renderSetSystems,
        inputs: ctx.inputs,
      };
      sub.run(childCtx);
    }
    ctx.app.renderer.submit([encoder.finish()]);
  },
};
