import type { Entity } from '@retro-engine/ecs';
import type { ColorAttachment, RenderPassDescriptor } from '@retro-engine/renderer-core';

import type { NodeRunContext, ViewNode } from '../render-graph/node';
import { createLabel } from '../render-graph/render-label';
import { ViewPrepassTargets } from '../prepass/view-prepass-targets';

import { AoBlurPipeline } from './ao-blur-pipeline';
import { AoPipeline } from './ao-pipeline';
import { AoTemporalPipeline } from './ao-temporal-pipeline';
import { ViewAo } from './view-ao';
import { AO_HISTORY_FORMAT, AO_TARGET_FORMAT, ViewAoTargets } from './view-ao-targets';

/**
 * Label for the Core3d ambient-occlusion GTAO pass node. Inserted by `AoPlugin`
 * after `PrepassNode3dLabel`.
 */
export const AoGtaoPass3dLabel = createLabel('ao_gtao_pass_3d');

/**
 * Label for the Core3d ambient-occlusion denoise (bilateral blur) pass node.
 * Inserted by `AoPlugin` between the GTAO pass and `OpaquePass3dLabel`.
 */
export const AoBlurPass3dLabel = createLabel('ao_blur_pass_3d');

/**
 * Label for the Core3d ambient-occlusion temporal accumulation pass node.
 * Inserted by `AoPlugin` between the blur pass and `OpaquePass3dLabel`, and only
 * effective when the camera has a motion-vector prepass (else it skips and the
 * blurred AO is the final result).
 */
export const AoTemporalPass3dLabel = createLabel('ao_temporal_pass_3d');

/**
 * Build the GTAO `ViewNode`.
 *
 * Skips silently when the camera has no extracted AO params, no allocated AO
 * target (prerequisites unmet), no normal prepass target to read, or the
 * pipeline has not initialised. Otherwise it reads the depth + normal prepass
 * and writes the per-pixel occlusion factor into the camera's AO target, which
 * the opaque forward pass then samples at `@group(3)` to modulate its ambient
 * term.
 */
export const makeAoGtaoNode = (): ViewNode => ({
  label: AoGtaoPass3dLabel,
  __viewNode: true as const,
  input: (): readonly never[] => [],
  output: (): readonly never[] => [],
  run(ctx: NodeRunContext): void {
    const view = ctx.view;
    const encoder = ctx.encoder;
    if (view === undefined || encoder === undefined) return;

    const entity = view.sourceEntity as Entity;
    const params = ctx.app.getResource(ViewAo)?.byCamera.get(entity);
    if (params === undefined) return;

    const target = ctx.app.getResource(ViewAoTargets)?.perCamera.get(entity);
    if (target === undefined) return;

    const prepass = ctx.app.getResource(ViewPrepassTargets)?.perCamera.get(entity);
    const depthView = prepass?.depth.view;
    const normalView = prepass?.normalView;
    if (depthView === undefined || normalView === undefined) return;

    const pipeline = ctx.app.getResource(AoPipeline);
    if (pipeline === undefined) return;
    if (!pipeline.ensureInitialised(ctx.app) || pipeline.specialized === undefined) return;

    const renderPipeline = pipeline.specialized.get({ key: { outputFormat: AO_TARGET_FORMAT } });
    const bindGroup = pipeline.bindGroupFor(
      ctx.app,
      entity,
      depthView,
      normalView,
      target.paramsBuffer,
    );

    const colorAttachment: ColorAttachment = {
      view: target.rawView,
      loadOp: 'clear',
      storeOp: 'store',
      clearValue: { r: 1, g: 1, b: 1, a: 1 },
    };
    const passDesc: RenderPassDescriptor = {
      label: `camera#${view.sourceEntity}.ao-gtao`,
      colorAttachments: [colorAttachment],
    };
    const pass = encoder.beginRenderPass(passDesc);
    pass.setPipeline(renderPipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3, 1, 0, 0);
    pass.end();
  },
});

/**
 * Build the AO temporal accumulation `ViewNode`: reproject last frame's
 * accumulated AO along the motion-vector prepass, reject on disocclusion, and
 * blend with the current blurred AO into this frame's history slot (which
 * `finalView` points at). Effective only when the camera has a motion-vector
 * target and a history pair; otherwise it skips and the blurred AO stays final.
 */
export const makeAoTemporalNode = (): ViewNode => ({
  label: AoTemporalPass3dLabel,
  __viewNode: true as const,
  input: (): readonly never[] => [],
  output: (): readonly never[] => [],
  run(ctx: NodeRunContext): void {
    const view = ctx.view;
    const encoder = ctx.encoder;
    if (view === undefined || encoder === undefined) return;

    const entity = view.sourceEntity as Entity;
    if (ctx.app.getResource(ViewAo)?.byCamera.get(entity) === undefined) return;

    const target = ctx.app.getResource(ViewAoTargets)?.perCamera.get(entity);
    if (target === undefined || target.historyViews === undefined) return;

    const prepass = ctx.app.getResource(ViewPrepassTargets)?.perCamera.get(entity);
    const motionView = prepass?.motionView;
    const depthView = prepass?.depth.view;
    if (motionView === undefined || depthView === undefined) return;

    const pipeline = ctx.app.getResource(AoTemporalPipeline);
    if (pipeline === undefined) return;
    if (!pipeline.ensureInitialised(ctx.app) || pipeline.specialized === undefined) return;

    const renderPipeline = pipeline.specialized.get({ key: { outputFormat: AO_HISTORY_FORMAT } });
    const writeSlot = target.current;
    const historyView = target.historyViews[(writeSlot ^ 1) as 0 | 1];
    const bindGroup = pipeline.bindGroupFor(
      ctx.app,
      entity,
      target.blurredView,
      historyView,
      motionView,
      depthView,
      target.paramsBuffer,
    );

    const colorAttachment: ColorAttachment = {
      view: target.historyViews[writeSlot],
      loadOp: 'clear',
      storeOp: 'store',
      clearValue: { r: 1, g: 0, b: 0, a: 1 },
    };
    const passDesc: RenderPassDescriptor = {
      label: `camera#${view.sourceEntity}.ao-temporal`,
      colorAttachments: [colorAttachment],
    };
    const pass = encoder.beginRenderPass(passDesc);
    pass.setPipeline(renderPipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3, 1, 0, 0);
    pass.end();
  },
});

/**
 * Build the AO denoise `ViewNode`: a depth-aware bilateral blur of the raw GTAO
 * output into the camera's blurred AO target (which `finalView` — the texture
 * the opaque pass samples — points at). Skips silently under the same
 * conditions as the GTAO node.
 */
export const makeAoBlurNode = (): ViewNode => ({
  label: AoBlurPass3dLabel,
  __viewNode: true as const,
  input: (): readonly never[] => [],
  output: (): readonly never[] => [],
  run(ctx: NodeRunContext): void {
    const view = ctx.view;
    const encoder = ctx.encoder;
    if (view === undefined || encoder === undefined) return;

    const entity = view.sourceEntity as Entity;
    if (ctx.app.getResource(ViewAo)?.byCamera.get(entity) === undefined) return;

    const target = ctx.app.getResource(ViewAoTargets)?.perCamera.get(entity);
    if (target === undefined) return;

    const depthView = ctx.app.getResource(ViewPrepassTargets)?.perCamera.get(entity)?.depth.view;
    if (depthView === undefined) return;

    const pipeline = ctx.app.getResource(AoBlurPipeline);
    if (pipeline === undefined) return;
    if (!pipeline.ensureInitialised(ctx.app) || pipeline.specialized === undefined) return;

    const renderPipeline = pipeline.specialized.get({ key: { outputFormat: AO_TARGET_FORMAT } });
    const bindGroup = pipeline.bindGroupFor(
      ctx.app,
      entity,
      target.rawView,
      depthView,
      target.paramsBuffer,
    );

    const colorAttachment: ColorAttachment = {
      view: target.blurredView,
      loadOp: 'clear',
      storeOp: 'store',
      clearValue: { r: 1, g: 1, b: 1, a: 1 },
    };
    const passDesc: RenderPassDescriptor = {
      label: `camera#${view.sourceEntity}.ao-blur`,
      colorAttachments: [colorAttachment],
    };
    const pass = encoder.beginRenderPass(passDesc);
    pass.setPipeline(renderPipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3, 1, 0, 0);
    pass.end();
  },
});
