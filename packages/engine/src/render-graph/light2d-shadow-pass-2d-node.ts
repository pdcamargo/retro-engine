import type { ColorAttachment, RenderPassDescriptor } from '@retro-engine/renderer-core';

import { Light2dShadowState } from '../light2d/light-2d-shadow';

import { Core2dLabel } from './core-2d';
import type { NodeRunContext, ViewNode } from './node';
import { createLabel } from './render-label';

/**
 * Label for the Phase 9 shadow-atlas build node. Inserted by `Light2dPlugin`
 * into the Core2d sub-graph, ordered before `Light2dAccumulationPass2dLabel`.
 */
export const Light2dShadowPass2dLabel = createLabel('light2d_shadow_pass_2d');

/**
 * Core2d node that builds the shared 2D shadow atlas — one 1D nearest-occluder
 * distance map per shadow-casting light.
 *
 * The atlas is camera-independent (occluders and lights are world-space), so it
 * is built once per frame: the first Core2d camera renders it, later cameras
 * see `builtThisFrame` and skip. Skips entirely when no light casts shadows
 * (no `Light2dShadowState`, no casters, or the pipeline is not yet ready).
 *
 * Draws a single fullscreen triangle into the atlas; the build fragment loops
 * the packed occluder segments analytically (no occluder-map intermediate).
 */
export const Light2dShadowPass2dNode: ViewNode = {
  label: Light2dShadowPass2dLabel,
  __viewNode: true as const,
  input: (): readonly never[] => [],
  output: (): readonly never[] => [],
  run(ctx: NodeRunContext): void {
    const view = ctx.view;
    const encoder = ctx.encoder;
    if (view === undefined) {
      throw new Error(
        'Light2dShadowPass2dNode: ctx.view is undefined; this node must run inside a camera-driven sub-graph.',
      );
    }
    if (encoder === undefined) {
      throw new Error(
        'Light2dShadowPass2dNode: ctx.encoder is undefined; the parent CameraDriverNode must open the frame encoder.',
      );
    }
    if (view.subGraph !== Core2dLabel) return;

    const shadow = ctx.app.getResource(Light2dShadowState);
    if (shadow === undefined || shadow.builtThisFrame) return;
    // Mark built even on the no-caster early-out so other cameras don't retry.
    shadow.builtThisFrame = true;
    if (
      shadow.casterCount === 0 ||
      shadow.buildPipeline === undefined ||
      shadow.buildBindGroup === undefined ||
      shadow.atlasView === undefined
    ) {
      return;
    }

    const colorAttachment: ColorAttachment = {
      view: shadow.atlasView,
      loadOp: 'clear',
      storeOp: 'store',
      // 1.0 = "no occluder within range" for any texel the draw does not touch.
      clearValue: { r: 1, g: 1, b: 1, a: 1 },
    };
    const passDesc: RenderPassDescriptor = {
      label: 'light2d_shadow_atlas',
      colorAttachments: [colorAttachment],
    };
    const pass = encoder.beginRenderPass(passDesc);
    pass.setPipeline(shadow.buildPipeline);
    pass.setBindGroup(0, shadow.buildBindGroup);
    pass.draw(3, 1, 0, 0);
    pass.end();
  },
};
