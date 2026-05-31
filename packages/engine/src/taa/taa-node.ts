import type { Entity } from '@retro-engine/ecs';
import type { ColorAttachment, RenderPassDescriptor } from '@retro-engine/renderer-core';

import { CurrentHdrView } from '../camera/current-hdr-view';
import { ViewPrepassTargets } from '../prepass/view-prepass-targets';
import type { NodeRunContext, ViewNode } from '../render-graph/node';
import { createLabel } from '../render-graph/render-label';

import { TaaPipeline } from './taa-pipeline';
import { ViewTaa } from './view-taa';
import { TAA_TARGET_FORMAT, ViewTaaTargets } from './view-taa-targets';

/**
 * Label for the Core3d TAA resolve pass node. Inserted by `TaaPlugin` after
 * `TransparentPass3dLabel` and before `MotionBlurPass3dLabel`.
 */
export const TaaPass3dLabel = createLabel('taa_pass_3d');

/**
 * Build the TAA resolve `ViewNode`.
 *
 * The node skips silently when the camera is not HDR, has no extracted TAA
 * params, has no allocated history targets (prerequisites unmet), has no
 * motion-vector target, or the pipeline has not initialised. Otherwise it
 * blends the current HDR scene against the reprojected previous frame, writing
 * into the active history slot, and publishes that slot as the current scene
 * view so the rest of the post chain reads the resolved result.
 */
export const makeTaaNode = (): ViewNode => ({
  label: TaaPass3dLabel,
  __viewNode: true as const,
  input: (): readonly never[] => [],
  output: (): readonly never[] => [],
  run(ctx: NodeRunContext): void {
    const view = ctx.view;
    const encoder = ctx.encoder;
    if (view === undefined || encoder === undefined) return;
    if (!view.hdr) return;

    const entity = view.sourceEntity as Entity;
    const params = ctx.app.getResource(ViewTaa)?.byCamera.get(entity);
    if (params === undefined) return;

    const entry = ctx.app.getResource(ViewTaaTargets)?.perCamera.get(entity);
    if (entry === undefined) return;

    const motionView = ctx.app.getResource(ViewPrepassTargets)?.perCamera.get(entity)?.motionView;
    if (motionView === undefined) return;

    const pipeline = ctx.app.getResource(TaaPipeline);
    if (pipeline === undefined) return;
    const ready = pipeline.ensureInitialised(ctx.app);
    if (!ready || pipeline.specialized === undefined) return;

    const writeIdx = entry.current;
    const writeView = entry.views[writeIdx]!;
    const historyView = entry.views[writeIdx ^ 1]!;

    // Read whatever the preceding pass left as the current scene view (the raw
    // jittered HDR for a TAA-first chain), falling back to the HDR intermediate.
    const currentHdr = ctx.app.getResource(CurrentHdrView);
    const sceneView = currentHdr?.perCamera.get(entity) ?? view.mainColorTarget.view;

    const renderPipeline = pipeline.specialized.get({ key: { outputFormat: TAA_TARGET_FORMAT } });
    const bindGroup = pipeline.bindGroupFor(
      ctx.app,
      entity,
      sceneView,
      historyView,
      motionView,
      entry.paramsBuffer,
    );

    const colorAttachment: ColorAttachment = {
      view: writeView,
      loadOp: 'clear',
      storeOp: 'store',
      clearValue: { r: 0, g: 0, b: 0, a: 1 },
    };
    const passDesc: RenderPassDescriptor = {
      label: `camera#${view.sourceEntity}.taa`,
      colorAttachments: [colorAttachment],
    };
    const pass = encoder.beginRenderPass(passDesc);
    pass.setPipeline(renderPipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3, 1, 0, 0);
    pass.end();

    // The slot just written is now usable history for next frame, and the
    // resolved result is the current scene view for downstream passes.
    entry.valid = true;
    currentHdr?.perCamera.set(entity, writeView);
  },
});
