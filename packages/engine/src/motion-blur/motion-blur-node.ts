import type { Entity } from '@retro-engine/ecs';
import type { ColorAttachment, RenderPassDescriptor } from '@retro-engine/renderer-core';

import { CurrentHdrView } from '../camera/current-hdr-view';
import type { NodeRunContext, ViewNode } from '../render-graph/node';
import { createLabel } from '../render-graph/render-label';
import { ViewPrepassTargets } from '../prepass/view-prepass-targets';

import { MotionBlurPipeline } from './motion-blur-pipeline';
import { ViewMotionBlur } from './view-motion-blur';
import { MOTION_BLUR_TARGET_FORMAT, ViewMotionBlurTargets } from './view-motion-blur-targets';

/**
 * Label for the Core3d motion-blur pass node. Inserted by `MotionBlurPlugin`
 * after `TransparentPass3dLabel` and before `TonemappingPass3dLabel`.
 */
export const MotionBlurPass3dLabel = createLabel('motion_blur_pass_3d');

/**
 * Build the motion-blur `ViewNode`.
 *
 * The node skips silently when the camera is not HDR, has no extracted
 * motion-blur params, has no allocated output intermediate (prerequisites
 * unmet), has no motion-vector target to sample, or the pipeline has not
 * initialised. Otherwise it samples the camera's HDR scene
 * (`view.mainColorTarget`) along the per-pixel velocity from the motion target
 * and writes the blurred result into the motion-blur intermediate, which the
 * tonemap pass then reads in place of the raw HDR target.
 */
export const makeMotionBlurNode = (): ViewNode => ({
  label: MotionBlurPass3dLabel,
  __viewNode: true as const,
  input: (): readonly never[] => [],
  output: (): readonly never[] => [],
  run(ctx: NodeRunContext): void {
    const view = ctx.view;
    const encoder = ctx.encoder;
    if (view === undefined || encoder === undefined) return;
    if (!view.hdr) return;

    const entity = view.sourceEntity as Entity;
    const params = ctx.app.getResource(ViewMotionBlur)?.byCamera.get(entity);
    if (params === undefined) return;

    const output = ctx.app.getResource(ViewMotionBlurTargets)?.perCamera.get(entity);
    if (output === undefined) return;

    const motionView = ctx.app.getResource(ViewPrepassTargets)?.perCamera.get(entity)?.motionView;
    if (motionView === undefined) return;

    const pipeline = ctx.app.getResource(MotionBlurPipeline);
    if (pipeline === undefined) return;
    const ready = pipeline.ensureInitialised(ctx.app);
    if (!ready || pipeline.specialized === undefined) return;

    const renderPipeline = pipeline.specialized.get({
      key: { outputFormat: MOTION_BLUR_TARGET_FORMAT },
    });
    // Read whatever the preceding HDR post pass left as the current scene view
    // (e.g. the TAA-resolved color), falling back to the raw HDR intermediate.
    const currentHdr = ctx.app.getResource(CurrentHdrView);
    const sceneView = currentHdr?.perCamera.get(entity) ?? view.mainColorTarget.view;
    const bindGroup = pipeline.bindGroupFor(
      ctx.app,
      entity,
      sceneView,
      motionView,
      output.paramsBuffer,
    );

    const colorAttachment: ColorAttachment = {
      view: output.view,
      loadOp: 'clear',
      storeOp: 'store',
      clearValue: { r: 0, g: 0, b: 0, a: 1 },
    };
    const passDesc: RenderPassDescriptor = {
      label: `camera#${view.sourceEntity}.motion-blur`,
      colorAttachments: [colorAttachment],
    };
    const pass = encoder.beginRenderPass(passDesc);
    pass.setPipeline(renderPipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3, 1, 0, 0);
    pass.end();

    // Publish the blurred result as the current scene view so the tonemap pass
    // (and any pass ordered after this one) reads it in place of the raw HDR.
    currentHdr?.perCamera.set(entity, output.view);
  },
});
