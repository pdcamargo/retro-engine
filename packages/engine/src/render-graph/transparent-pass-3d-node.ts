import type {
  ColorAttachment,
  DepthStencilAttachment,
  RenderPassDescriptor,
} from '@retro-engine/renderer-core';

import { GpuLights } from '../light3d/gpu-lights';
import type { RenderContext } from '../index';

import type { NodeRunContext, ViewNode } from './node';
import { ViewPhases3d } from './phase-3d';
import { createLabel } from './render-label';

/**
 * Label for the Core3d transparent pass node. The `Transparent3d` phase
 * items render here, back-to-front, with `depthWriteEnabled: false` on their
 * pipelines so a later transparent draw does not occlude an earlier one
 * unless their depths cross.
 */
export const TransparentPass3dLabel = createLabel('transparent_pass_3d');

/**
 * Core3d phase node draining the camera's `Transparent3d` phase items.
 *
 * Opens a second render pass against the same color target as
 * `OpaquePass3dNode` (`loadOp: 'load'` so the opaque silhouette is preserved
 * as the compositing base) and the same depth view
 * (`depthLoadOp: 'load'`, `depthStoreOp: 'discard'` — the depth values
 * accumulated by the opaque pass gate transparent fragments, and we throw the
 * depth output away once the frame is done). Transparent pipelines should
 * carry `depthWriteEnabled: false` so two overlapping transparent draws
 * composite correctly when sorted back-to-front.
 */
export const TransparentPass3dNode: ViewNode = {
  label: TransparentPass3dLabel,
  __viewNode: true as const,
  input: (): readonly never[] => [],
  output: (): readonly never[] => [],
  run(ctx: NodeRunContext): void {
    const view = ctx.view;
    const encoder = ctx.encoder;
    if (view === undefined) {
      throw new Error(
        'TransparentPass3dNode: ctx.view is undefined; this node must run inside a camera-driven sub-graph.',
      );
    }
    if (encoder === undefined) {
      throw new Error(
        'TransparentPass3dNode: ctx.encoder is undefined; the parent CameraDriverNode must open the frame encoder.',
      );
    }
    const phases = ctx.app.getResource(ViewPhases3d);
    const transparent = phases?.transparent.get(view.sourceEntity);
    if (transparent === undefined || transparent.length === 0) return;

    const colorTargetView = view.mainColorTarget.view;
    const colorAttachment: ColorAttachment = {
      view: colorTargetView,
      // Always load — the opaque pass cleared and wrote the silhouette; we
      // composite onto it.
      loadOp: 'load',
      storeOp: 'store',
    };
    const passDesc: RenderPassDescriptor = {
      label: `camera#${view.sourceEntity}.transparent3d`,
      colorAttachments: [colorAttachment],
    };
    if (view.depth) {
      // Read-only: the opaque pass's depth gates transparent fragments (pipelines
      // carry `depthWriteEnabled: false`), and nothing writes here. WebGPU forbids
      // `depthLoadOp`/`depthStoreOp` when `depthReadOnly` is set — the existing
      // depth is loaded implicitly and never stored.
      const depthAttachment: DepthStencilAttachment = {
        view: view.depth.view,
        depthReadOnly: true,
      };
      passDesc.depthStencilAttachment = depthAttachment;
    }
    const pass = encoder.beginRenderPass(passDesc);
    pass.setBindGroup(0, view.viewBindGroup);
    // Lit materials read the analytic lights at @group(2); see OpaquePass3dNode.
    const lights = ctx.app.getResource(GpuLights);
    if (lights?.bindGroup !== undefined) pass.setBindGroup(2, lights.bindGroup);
    const renderCtx: RenderContext = {
      encoder,
      pass,
      surfaceView: colorTargetView,
      camera: view,
    };
    transparent.sort((a, b) => b.sortDepth - a.sortDepth); // back-to-front
    for (const item of transparent) item.draw(pass, renderCtx);
    pass.end();
  },
};
