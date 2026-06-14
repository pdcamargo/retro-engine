import type {
  ColorAttachment,
  DepthStencilAttachment,
  RenderPassDescriptor,
} from '@retro-engine/renderer-core';

import { EDITOR_GIZMO_MASK } from '../gizmos/gizmo-layers';
import type { NodeRunContext, ViewNode } from '../render-graph/node';
import { createLabel } from '../render-graph/render-label';

import { EditorGrid } from './grid-config';
import { GridRenderState } from './grid-render-state';

/** Label for the editor grid pass inside the Core3d sub-graph. */
export const GridPass3dLabel = createLabel('grid_pass_3d');

/**
 * Build the editor grid pass node for a sub-graph.
 *
 * Like the gizmo pass it draws over the camera's **final** target after
 * tonemapping (so the configured colors are exact and the grid never feeds the
 * HDR intermediate or TAA history), binding the scene depth so geometry
 * occludes it. It runs before the gizmo pass, so transform handles sit on top.
 *
 * The pass is gated to the editor gizmo layer: a camera draws the grid only
 * when its `renderLayers` mask includes `EDITOR_GIZMO_LAYER`. Game cameras keep
 * the default mask and so never show it.
 */
export const makeGridPassNode = (label: ReturnType<typeof createLabel>): ViewNode => ({
  label,
  __viewNode: true as const,
  input: (): readonly never[] => [],
  output: (): readonly never[] => [],
  run(ctx: NodeRunContext): void {
    const view = ctx.view;
    const encoder = ctx.encoder;
    if (view === undefined) {
      throw new Error('GridPassNode: ctx.view is undefined; this node must run inside a camera-driven sub-graph.');
    }
    if (encoder === undefined) {
      throw new Error('GridPassNode: ctx.encoder is undefined; the parent CameraDriverNode must open the frame encoder.');
    }

    const config = ctx.app.getResource(EditorGrid);
    if (config === undefined || !config.enabled) return;
    // Only editor-layer cameras draw the grid.
    if ((EDITOR_GIZMO_MASK & view.renderLayers) === 0) return;

    const state = ctx.app.getResource(GridRenderState);
    if (state === undefined) return;

    const colorAttachment: ColorAttachment = {
      view: view.target.view,
      loadOp: 'load',
      storeOp: 'store',
    };
    const passDesc: RenderPassDescriptor = {
      label: `camera#${view.sourceEntity}.grid`,
      colorAttachments: [colorAttachment],
    };
    const depthFormat = view.depth ? view.depth.format : null;
    if (view.depth) {
      // Load and keep the scene depth. The grid never writes depth
      // (`depthWriteEnabled: false`); `depthReadOnly` is intentionally not set —
      // WebGPU forbids pairing it with explicit depth load/store ops.
      const depthAttachment: DepthStencilAttachment = {
        view: view.depth.view,
        depthLoadOp: 'load',
        depthStoreOp: 'store',
      };
      passDesc.depthStencilAttachment = depthAttachment;
    }

    const pass = encoder.beginRenderPass(passDesc);
    pass.setBindGroup(0, view.viewBindGroup);
    pass.setBindGroup(1, state.bindGroup);
    pass.setPipeline(state.pipeline({ colorFormat: view.target.format, depthFormat }));
    pass.draw(6, 1, 0);
    pass.end();
  },
});
