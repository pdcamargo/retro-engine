import type { ColorAttachment } from '@retro-engine/renderer-core';

import type { RenderContext } from '../index';
import { RenderSet } from '../render-set';

import type { NodeRunContext, ViewNode } from './node';
import { createLabel } from './render-label';

/**
 * Label for the engine's default per-camera draw pass.
 *
 * Day-1 sub-graphs (`Core2d`, `Core3d`) register a single node — the
 * {@link MainPassNode} singleton — under this label. The node opens one
 * color-attachment render pass against the active camera's resolved target,
 * runs every system in {@link RenderSet.Render} once with the active pass in
 * its `RenderCtx`, and ends the pass.
 *
 * Phase 8 replaces this node inside `Core2d` with the
 * `Opaque2d` / `AlphaMask2d` / `Transparent2d` phase trio; Phase 10 expands
 * `Core3d`'s rendering with depth + lighting nodes. The label exists today so
 * plugins can position their own nodes "before the main pass" / "after the
 * main pass" while migration is in progress.
 */
export const MainPassLabel = createLabel('main_pass');

/**
 * Day-1 shim {@link ViewNode}: opens the per-camera render pass and dispatches
 * the existing `RenderSet.Render` systems against it. Replicates the body of
 * `App.renderFrame()`'s per-camera lambda one-for-one — ADR-0019 and ADR-0020
 * promised "no restructuring" when the graph lands, and this node is how that
 * promise is kept.
 *
 * The node is stateless and is reused as a singleton across every sub-graph
 * that wants the default behavior.
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
