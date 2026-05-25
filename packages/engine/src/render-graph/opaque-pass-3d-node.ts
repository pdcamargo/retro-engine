import type {
  ColorAttachment,
  DepthStencilAttachment,
  RenderPassDescriptor,
} from '@retro-engine/renderer-core';

import type { RenderContext } from '../index';

import type { NodeRunContext, ViewNode } from './node';
import { ViewPhases3d } from './phase-3d';
import { createLabel } from './render-label';

/**
 * Label for the Core3d opaque pass node. The `Opaque3d` + `AlphaMask3d` phase
 * items share this pass: both write depth, both sort front-to-back, both
 * benefit from early-Z.
 */
export const OpaquePass3dLabel = createLabel('opaque_pass_3d');

/**
 * Core3d phase node draining the camera's `Opaque3d` and `AlphaMask3d` phase
 * items into one render pass.
 *
 * Pass shape:
 *
 * - Color attachment: the camera's resolved target. `loadOp` mirrors the
 *   camera's `loadOp` (`'clear'` when the camera carries a clear color,
 *   `'load'` otherwise).
 * - Depth attachment: the camera's `view.depth.view` when present;
 *   `depthLoadOp: 'clear'` (clearValue = 1.0), `depthStoreOp: 'store'` so the
 *   subsequent `TransparentPass3dNode` can depth-test against the opaque
 *   silhouette. A camera with `depthTarget: 'none'` runs without a depth
 *   attachment — pipelines that require depth will fail backend validation
 *   in that case, which is the right loud failure mode.
 *
 * After opening the pass, the node pre-binds the view bind group at
 * `@group(0)`, sorts opaque items front-to-back, draws them, sorts alpha-mask
 * items front-to-back, draws them, then ends the pass.
 */
export const OpaquePass3dNode: ViewNode = {
  label: OpaquePass3dLabel,
  __viewNode: true as const,
  input: (): readonly never[] => [],
  output: (): readonly never[] => [],
  run(ctx: NodeRunContext): void {
    const view = ctx.view;
    const encoder = ctx.encoder;
    if (view === undefined) {
      throw new Error(
        'OpaquePass3dNode: ctx.view is undefined; this node must run inside a camera-driven sub-graph.',
      );
    }
    if (encoder === undefined) {
      throw new Error(
        'OpaquePass3dNode: ctx.encoder is undefined; the parent CameraDriverNode must open the frame encoder.',
      );
    }
    const phases = ctx.app.getResource(ViewPhases3d);
    const colorAttachment: ColorAttachment = {
      view: view.target.view,
      loadOp: view.loadOp,
      storeOp: 'store',
      ...(view.clearColor !== undefined ? { clearValue: view.clearColor } : {}),
    };
    const passDesc: RenderPassDescriptor = {
      label: `camera#${view.sourceEntity}.opaque3d`,
      colorAttachments: [colorAttachment],
    };
    if (view.depth) {
      const depthAttachment: DepthStencilAttachment = {
        view: view.depth.view,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
        depthClearValue: 1.0,
      };
      passDesc.depthStencilAttachment = depthAttachment;
    }
    const pass = encoder.beginRenderPass(passDesc);
    pass.setBindGroup(0, view.viewBindGroup);
    const renderCtx: RenderContext = {
      encoder,
      pass,
      surfaceView: view.target.view,
      camera: view,
    };
    if (phases !== undefined) {
      const opaque = phases.opaque.get(view.sourceEntity);
      if (opaque !== undefined && opaque.length > 0) {
        opaque.sort((a, b) => a.sortDepth - b.sortDepth);
        for (const item of opaque) item.draw(pass, renderCtx);
      }
      const mask = phases.alphaMask.get(view.sourceEntity);
      if (mask !== undefined && mask.length > 0) {
        mask.sort((a, b) => a.sortDepth - b.sortDepth);
        for (const item of mask) item.draw(pass, renderCtx);
      }
    }
    pass.end();
  },
};
