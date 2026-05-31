import type { Entity } from '@retro-engine/ecs';
import type { ColorAttachment, RenderPassDescriptor } from '@retro-engine/renderer-core';

import { ViewMotionBlurTargets } from '../motion-blur/view-motion-blur-targets';
import type { NodeRunContext, ViewNode } from '../render-graph/node';
import { createLabel } from '../render-graph/render-label';
import type { RenderLabel } from '../render-graph/render-label';

import { TonemappingPipeline } from './tonemapping-pipeline';
import { ViewTonemapping } from './view-tonemapping';

/**
 * Label for the Core2d tonemap pass node. Inserted by `TonemappingPlugin`
 * after `Light2dCompositePass2dLabel` when the light plugin is installed,
 * or after `TransparentPass2dLabel` otherwise.
 */
export const TonemappingPass2dLabel = createLabel('tonemapping_pass_2d');

/**
 * Label for the Core3d tonemap pass node. Inserted by `TonemappingPlugin`
 * after `TransparentPass3dLabel`.
 */
export const TonemappingPass3dLabel = createLabel('tonemapping_pass_3d');

/**
 * Build a tonemap `ViewNode` registered under `label` (one of
 * {@link TonemappingPass2dLabel} or {@link TonemappingPass3dLabel}).
 *
 * The node skips silently when:
 *
 * - `view.hdr` is `false` (the camera writes directly to its final target,
 *   so there is no HDR intermediate to read from), or
 * - no `Tonemapping` component is extracted for this camera (the user
 *   removed the bundle-default component), or
 * - the pipeline has not initialised yet (first-frame race; see
 *   {@link TonemappingPipeline.ensureInitialised}).
 *
 * Otherwise it opens a render pass with a single color attachment =
 * `view.target.view` (the camera's final target), binds the per-camera
 * input bind group, sets the pipeline specialized on
 * `{ outputFormat: view.target.format, method }`, and draws one fullscreen
 * triangle.
 */
export const makeTonemappingNode = (label: RenderLabel): ViewNode => ({
  label,
  __viewNode: true as const,
  input: (): readonly never[] => [],
  output: (): readonly never[] => [],
  run(ctx: NodeRunContext): void {
    const view = ctx.view;
    const encoder = ctx.encoder;
    if (view === undefined) {
      throw new Error(
        `${String(label)}: ctx.view is undefined; this node must run inside a camera-driven sub-graph.`,
      );
    }
    if (encoder === undefined) {
      throw new Error(
        `${String(label)}: ctx.encoder is undefined; the parent CameraDriverNode must open the frame encoder.`,
      );
    }
    if (!view.hdr) return;
    const extracted = ctx.app.getResource(ViewTonemapping);
    const method = extracted?.byCamera.get(view.sourceEntity as Entity);
    if (method === undefined) return;
    const pipeline = ctx.app.getResource(TonemappingPipeline);
    if (pipeline === undefined) return;
    const ready = pipeline.ensureInitialised(ctx.app);
    if (!ready || pipeline.specialized === undefined) return;

    const renderPipeline = pipeline.specialized.get({
      key: { outputFormat: view.target.format, method },
    });
    // When a motion-blur pass ran for this camera it wrote a blurred copy of the
    // HDR scene into its own intermediate; tonemap that instead of the raw HDR
    // target. Falls back to the HDR target when no blur output exists.
    const blurredView = ctx.app
      .getResource(ViewMotionBlurTargets)
      ?.perCamera.get(view.sourceEntity as Entity)?.view;
    const bindGroup = pipeline.bindGroupFor(
      ctx.app,
      view.sourceEntity as Entity,
      blurredView ?? view.mainColorTarget.view,
    );

    const colorAttachment: ColorAttachment = {
      view: view.target.view,
      loadOp: 'clear',
      storeOp: 'store',
      clearValue: { r: 0, g: 0, b: 0, a: 1 },
    };
    const passDesc: RenderPassDescriptor = {
      label: `camera#${view.sourceEntity}.tonemapping`,
      colorAttachments: [colorAttachment],
    };
    const pass = encoder.beginRenderPass(passDesc);
    pass.setPipeline(renderPipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3, 1, 0, 0);
    pass.end();
  },
});
