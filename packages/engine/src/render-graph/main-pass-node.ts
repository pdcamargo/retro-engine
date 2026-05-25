import type { ColorAttachment } from '@retro-engine/renderer-core';

import type { RenderContext } from '../index';
import { RenderSet } from '../render-set';

import type { NodeRunContext, ViewNode } from './node';
import { createLabel } from './render-label';

/**
 * Label for the Core2d default per-camera draw pass.
 *
 * The Phase 7 {@link MainPassNode} singleton registers under this label inside
 * the `Core2d` sub-graph. It opens one color-attachment render pass against
 * the active camera's resolved target, pre-binds `@group(0)` to the camera's
 * view bind group (ADR-0028 §11), runs every system in {@link RenderSet.Render}
 * once with the active pass in its `RenderCtx`, and ends the pass.
 *
 * Core3d does *not* use this node anymore — it ships the `Opaque3d` /
 * `AlphaMask3d` / `Transparent3d` phase trio (ADR-0028 §10). Phase 8 will
 * displace `MainPassNode` inside `Core2d` with the 2D phase trio; the label
 * exists today so plugins can position their own nodes "before the main pass"
 * / "after the main pass" while migration is in progress.
 */
export const MainPassLabel = createLabel('main_pass');

/**
 * Core2d default-pass {@link ViewNode}: opens the per-camera render pass,
 * pre-binds the view bind group at `@group(0)`, and dispatches every
 * `RenderSet.Render` system against the open pass.
 *
 * `@group(0)` auto-bind (ADR-0028 §11): the engine sets the view bind group
 * before any render-set system runs. Material pipelines that want view data
 * lay out `@group(0) @binding(0)` and read it; user pipelines that re-bind
 * `@group(0)` to their own data are unsupported.
 *
 * The node is stateless and is reused as a singleton across every sub-graph
 * that registers it.
 */
export const MainPassNode: ViewNode = {
  label: MainPassLabel,
  __viewNode: true as const,
  input: (): readonly never[] => [],
  output: (): readonly never[] => [],
  run(ctx: NodeRunContext): void {
    const view = ctx.view;
    const encoder = ctx.encoder;
    if (view === undefined) {
      throw new Error('MainPassNode: ctx.view is undefined; this node must run inside a camera-driven sub-graph.');
    }
    if (encoder === undefined) {
      throw new Error('MainPassNode: ctx.encoder is undefined; the parent CameraDriverNode must open the frame encoder.');
    }
    const attachment: ColorAttachment = {
      view: view.target.view,
      loadOp: view.loadOp,
      storeOp: 'store',
      ...(view.clearColor !== undefined ? { clearValue: view.clearColor } : {}),
    };
    const pass = encoder.beginRenderPass({
      label: `camera#${view.sourceEntity}`,
      colorAttachments: [attachment],
    });
    pass.setBindGroup(0, view.viewBindGroup);
    const render: RenderContext = {
      encoder,
      pass,
      surfaceView: view.target.view,
      camera: view,
    };
    const systems = ctx.renderSetSystems.get(RenderSet.Render);
    ctx.app.runRenderSet(systems, RenderSet.Render, render);
    pass.end();
  },
};
