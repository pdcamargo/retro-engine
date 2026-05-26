import type { Entity } from '@retro-engine/ecs';
import type { ColorAttachment, RenderPassDescriptor } from '@retro-engine/renderer-core';

import type { RenderContext } from '../index';
import { ViewLight2dTargets } from '../light2d/light-2d-targets';

import type { NodeRunContext, ViewNode } from './node';
import { ViewPhases2d } from './phase-2d';
import { createLabel } from './render-label';

/**
 * Label for the Core2d transparent pass node. The `Transparent2d` phase items
 * render here, back-to-front. With no depth buffer, ordering is the only
 * compositing correctness mechanism — sort, draw, composite.
 */
export const TransparentPass2dLabel = createLabel('transparent_pass_2d');

/**
 * Core2d phase node draining the camera's `Transparent2d` phase items.
 *
 * Opens a second render pass against the same color target as
 * `OpaquePass2dNode` (`loadOp: 'load'` so the opaque pass's output becomes the
 * compositing base). No depth attachment — the painter's-algorithm sort drives
 * ordering. Transparent pipelines should carry the canonical premultiplied-
 * alpha blend state so two overlapping transparent draws composite correctly
 * when sorted back-to-front.
 */
export const TransparentPass2dNode: ViewNode = {
  label: TransparentPass2dLabel,
  __viewNode: true as const,
  input: (): readonly never[] => [],
  output: (): readonly never[] => [],
  run(ctx: NodeRunContext): void {
    const view = ctx.view;
    const encoder = ctx.encoder;
    if (view === undefined) {
      throw new Error(
        'TransparentPass2dNode: ctx.view is undefined; this node must run inside a camera-driven sub-graph.',
      );
    }
    if (encoder === undefined) {
      throw new Error(
        'TransparentPass2dNode: ctx.encoder is undefined; the parent CameraDriverNode must open the frame encoder.',
      );
    }
    const phases = ctx.app.getResource(ViewPhases2d);
    const transparent = phases?.transparent.get(view.sourceEntity);
    if (transparent === undefined || transparent.length === 0) return;

    // Mirror the opaque pass's lighting-aware target redirect: when a
    // Light2dPlugin has allocated a baseColor texture for this camera,
    // the transparent pass composites on top of the opaque pass's
    // intermediate output rather than the surface.
    const targets = ctx.app.getResource(ViewLight2dTargets);
    const colorView = targets?.perCamera.get(view.sourceEntity as Entity)?.baseColorView ?? view.target.view;
    const colorAttachment: ColorAttachment = {
      view: colorView,
      loadOp: 'load',
      storeOp: 'store',
    };
    const passDesc: RenderPassDescriptor = {
      label: `camera#${view.sourceEntity}.transparent2d`,
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
    transparent.sort((a, b) => b.sortDepth - a.sortDepth);
    for (const item of transparent) item.draw(pass, renderCtx);
    pass.end();
  },
};
