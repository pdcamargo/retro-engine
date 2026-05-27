import type { Entity } from '@retro-engine/ecs';
import type { ColorAttachment, RenderPassDescriptor } from '@retro-engine/renderer-core';

import { Light2dPipeline } from '../light2d/light-2d-pipeline';
import { Light2dSettings } from '../light2d/light-2d-settings';
import { ViewLight2dTargets } from '../light2d/light-2d-targets';

import { Core2dLabel } from './core-2d';
import type { NodeRunContext, ViewNode } from './node';
import { createLabel } from './render-label';

/**
 * Label for the Phase 9 light composite pass node. Inserted by
 * `Light2dPlugin` into the Core2d sub-graph, ordered after
 * `TransparentPass2dLabel` so the chain reads
 * `Light2dAccumulationPass2d → OpaquePass2d → TransparentPass2d →
 * Light2dCompositePass2d`.
 */
export const Light2dCompositePass2dLabel = createLabel('light2d_composite_pass_2d');

/**
 * Core2d phase node that combines the per-camera `baseColor` (the geometry
 * passes' output) with the per-camera `lightAccum` and writes the product
 * to the camera's actual color target (`view.target.view`).
 *
 * Pass shape:
 *
 * - Color attachment: `view.target.view` — the camera's swapchain / texture /
 *   surface view. `loadOp: 'clear'`, `clearValue: (0, 0, 0, 1)` (the
 *   fullscreen triangle covers every pixel, so the clear value is cosmetic).
 * - No depth attachment.
 * - Bind group `@group(0)` carries the per-camera composite bind group from
 *   `ViewLight2dTargets` (baseColor texture + lightAccum texture + sampler).
 *
 * Draws a fullscreen triangle (`pass.draw(3, 1, 0, 0)`; no vertex / index
 * buffer is bound — vertices are generated from `vertex_index` in WGSL).
 *
 * Skips silently when `ViewLight2dTargets` has no entry for this camera —
 * that's the "lighting plugin not installed for this camera" path, and the
 * opaque / transparent nodes have already written to surface directly via
 * their fallback.
 */
export const Light2dCompositePass2dNode: ViewNode = {
  label: Light2dCompositePass2dLabel,
  __viewNode: true as const,
  input: (): readonly never[] => [],
  output: (): readonly never[] => [],
  run(ctx: NodeRunContext): void {
    const view = ctx.view;
    const encoder = ctx.encoder;
    if (view === undefined) {
      throw new Error(
        'Light2dCompositePass2dNode: ctx.view is undefined; this node must run inside a camera-driven sub-graph.',
      );
    }
    if (encoder === undefined) {
      throw new Error(
        'Light2dCompositePass2dNode: ctx.encoder is undefined; the parent CameraDriverNode must open the frame encoder.',
      );
    }
    if (view.subGraph !== Core2dLabel) return;
    const targets = ctx.app.getResource(ViewLight2dTargets);
    const entry = targets?.perCamera.get(view.sourceEntity as Entity);
    if (entry === undefined) return;
    const pipeline = ctx.app.getResource(Light2dPipeline);
    if (pipeline === undefined || pipeline.composite === undefined) return;

    const colorAttachment: ColorAttachment = {
      view: view.target.view,
      loadOp: 'clear',
      storeOp: 'store',
      clearValue: { r: 0, g: 0, b: 0, a: 1 },
    };
    const passDesc: RenderPassDescriptor = {
      label: `camera#${view.sourceEntity}.light2d_composite`,
      colorAttachments: [colorAttachment],
    };
    const compositeMode = ctx.app.getResource(Light2dSettings)?.compositeMode ?? 'multiply';
    const renderPipeline = pipeline.composite.get({
      key: { surfaceFormat: view.target.format, compositeMode },
    });
    const pass = encoder.beginRenderPass(passDesc);
    pass.setPipeline(renderPipeline);
    pass.setBindGroup(0, entry.compositeBindGroup);
    pass.draw(3, 1, 0, 0);
    pass.end();
  },
};
