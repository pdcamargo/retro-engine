import type { Entity } from '@retro-engine/ecs';
import type { ColorAttachment, RenderPassDescriptor } from '@retro-engine/renderer-core';

import type { RenderContext } from '../index';
import { ViewLight2dTargets } from '../light2d/light-2d-targets';

import type { NodeRunContext, ViewNode } from './node';
import { ViewPhases2d } from './phase-2d';
import { createLabel } from './render-label';

/**
 * Label for the Core2d opaque pass node. The `Opaque2d` + `AlphaMask2d` phase
 * items share this pass; both sort back-to-front. Core2d has no depth
 * attachment, so the only mechanism that controls visual order between
 * overlapping draws is the CPU sort — painter's algorithm applies to opaque
 * and mask phases just as it does to transparent. The opaque/mask/transparent
 * distinction in Core2d is purely about blend state, not sort direction.
 */
export const OpaquePass2dLabel = createLabel('opaque_pass_2d');

/**
 * Core2d phase node draining the camera's `Opaque2d` and `AlphaMask2d` phase
 * items into one render pass.
 *
 * Pass shape:
 *
 * - Color attachment: the camera's resolved target. `loadOp` mirrors the
 *   camera's `loadOp` (`'clear'` when the camera carries a clear color,
 *   `'load'` otherwise).
 * - No depth attachment. 2D rendering relies on the painter's-algorithm sort
 *   driven by `Transform.translation.z`; opting out of depth keeps the
 *   pipeline simpler and matches `Camera2d`'s default `depthTarget: 'none'`.
 *
 * After opening the pass, the node pre-binds the view bind group at
 * `@group(0)`, sorts opaque items back-to-front, draws them, sorts alpha-mask
 * items back-to-front, draws them, then ends the pass. Back-to-front matches
 * the painter's-algorithm order required without a depth buffer.
 */
export const OpaquePass2dNode: ViewNode = {
  label: OpaquePass2dLabel,
  __viewNode: true as const,
  input: (): readonly never[] => [],
  output: (): readonly never[] => [],
  run(ctx: NodeRunContext): void {
    const view = ctx.view;
    const encoder = ctx.encoder;
    if (view === undefined) {
      throw new Error(
        'OpaquePass2dNode: ctx.view is undefined; this node must run inside a camera-driven sub-graph.',
      );
    }
    if (encoder === undefined) {
      throw new Error(
        'OpaquePass2dNode: ctx.encoder is undefined; the parent CameraDriverNode must open the frame encoder.',
      );
    }
    const phases = ctx.app.getResource(ViewPhases2d);
    // When a Light2dPlugin is installed and has allocated a baseColor target
    // for this camera, redirect the opaque pass into that intermediate
    // texture so the composite pass can multiply it by the accumulated
    // lighting before the result reaches the camera's actual color target.
    // Absent the lighting plugin (no resource, or no entry for this
    // camera), the pass writes directly to `view.target.view` exactly as
    // it did pre-Phase-9.
    const targets = ctx.app.getResource(ViewLight2dTargets);
    const colorView = targets?.perCamera.get(view.sourceEntity as Entity)?.baseColorView ?? view.target.view;
    const colorAttachment: ColorAttachment = {
      view: colorView,
      loadOp: view.loadOp,
      storeOp: 'store',
      ...(view.clearColor !== undefined ? { clearValue: view.clearColor } : {}),
    };
    const passDesc: RenderPassDescriptor = {
      label: `camera#${view.sourceEntity}.opaque2d`,
      colorAttachments: [colorAttachment],
    };
    const pass = encoder.beginRenderPass(passDesc);
    pass.setBindGroup(0, view.viewBindGroup);
    const renderCtx: RenderContext = {
      encoder,
      pass,
      surfaceView: colorView,
      camera: view,
    };
    if (phases !== undefined) {
      const opaque = phases.opaque.get(view.sourceEntity);
      if (opaque !== undefined && opaque.length > 0) {
        opaque.sort((a, b) => b.sortDepth - a.sortDepth);
        for (const item of opaque) item.draw(pass, renderCtx);
      }
      const mask = phases.alphaMask.get(view.sourceEntity);
      if (mask !== undefined && mask.length > 0) {
        mask.sort((a, b) => b.sortDepth - a.sortDepth);
        for (const item of mask) item.draw(pass, renderCtx);
      }
    }
    pass.end();
  },
};
