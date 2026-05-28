import type {
  ColorAttachment,
  DepthStencilAttachment,
  RenderPassDescriptor,
} from '@retro-engine/renderer-core';

import type { RenderContext } from '../index';
import { Core3dLabel } from '../render-graph/core-3d';
import type { NodeRunContext, ViewNode } from '../render-graph/node';
import { ViewPhases3d } from '../render-graph/phase-3d';
import { createLabel } from '../render-graph/render-label';

import { ViewPrepassTargets } from './view-prepass-targets';

/**
 * Render-graph label for the screen-space prepass node. Inserted into the
 * Core3d sub-graph between `Shadow3dPass3dNode` (when present) and
 * `OpaquePass3dNode` by `PrepassPlugin`.
 */
export const PrepassNode3dLabel = createLabel('prepass_3d');

/**
 * Screen-space prepass node. Opens one render pass per camera that has any
 * prepass marker, populating up to three attachments before the opaque pass
 * runs:
 *
 * - Depth: written to the camera's primary depth attachment (shared with
 *   `OpaquePass3dNode`; the opaque pass subsequently loads instead of
 *   clearing).
 * - Normal: written to a per-camera `rgba16float` color attachment
 *   ({@link ViewPrepassTargets}).
 * - Motion vector: written to a per-camera `rg16float` color attachment.
 *
 * Cameras without any prepass marker have no entry in `ViewPrepassTargets`
 * and the node short-circuits with no GPU work. Phase-item iteration is
 * added in a later step alongside the material prepass pipelines.
 */
export const PrepassNode3d: ViewNode = {
  label: PrepassNode3dLabel,
  __viewNode: true as const,
  input: (): readonly never[] => [],
  output: (): readonly never[] => [],
  run(ctx: NodeRunContext): void {
    const view = ctx.view;
    const encoder = ctx.encoder;
    if (view === undefined || encoder === undefined) return;
    if (view.subGraph !== Core3dLabel) return;

    const targets = ctx.app.getResource(ViewPrepassTargets);
    const entry = targets?.perCamera.get(view.sourceEntity as never);
    if (entry === undefined) return;
    if (view.depth === undefined) return;

    const colorAttachments: ColorAttachment[] = [];
    if (entry.flags.normal && entry.normalView !== undefined) {
      colorAttachments.push({
        view: entry.normalView,
        loadOp: 'clear',
        storeOp: 'store',
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
      });
    }
    if (entry.flags.motionVector && entry.motionView !== undefined) {
      colorAttachments.push({
        view: entry.motionView,
        loadOp: 'clear',
        storeOp: 'store',
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
      });
    }

    const depthAttachment: DepthStencilAttachment = {
      view: view.depth.view,
      depthLoadOp: 'clear',
      depthStoreOp: 'store',
      depthClearValue: 1.0,
    };

    const passDesc: RenderPassDescriptor = {
      label: `camera#${view.sourceEntity}.prepass_3d`,
      colorAttachments,
      depthStencilAttachment: depthAttachment,
    };
    const pass = encoder.beginRenderPass(passDesc);
    pass.setBindGroup(0, view.viewBindGroup);
    const items = ctx.app.getResource(ViewPhases3d)?.prepass.get(view.sourceEntity);
    if (items !== undefined && items.length > 0) {
      // Sort front-to-back to match the opaque pass's early-Z assumptions.
      items.sort((a, b) => a.sortDepth - b.sortDepth);
      const renderCtx: RenderContext = {
        encoder,
        pass,
        surfaceView: view.target.view,
        camera: view,
      };
      for (const item of items) item.draw(pass, renderCtx);
    }
    pass.end();
  },
};
