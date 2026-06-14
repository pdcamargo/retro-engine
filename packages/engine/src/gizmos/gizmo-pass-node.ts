import type {
  ColorAttachment,
  DepthStencilAttachment,
  RenderPassDescriptor,
} from '@retro-engine/renderer-core';

import type { NodeRunContext, ViewNode } from '../render-graph/node';
import { createLabel } from '../render-graph/render-label';

import { GizmoMesh } from './gizmo-mesh';

/** Label for the gizmo line pass inside the Core3d sub-graph. */
export const GizmoPass3dLabel = createLabel('gizmo_pass_3d');

/** Label for the gizmo line pass inside the Core2d sub-graph. */
export const GizmoPass2dLabel = createLabel('gizmo_pass_2d');

/**
 * Build the gizmo line-pass node for a sub-graph.
 *
 * The node draws this frame's gizmo segments over the camera's **final** target
 * (`view.target`) — it runs last, after tonemapping, so it never feeds the HDR
 * intermediate or the TAA temporal history (which would ghost the handles) and
 * needs no tone curve of its own. It is depth-aware: when the camera has a depth
 * attachment (3D) it depth-tests the occluded segments and draws the
 * always-on-top ones with `depthCompare: 'always'`; when the camera has no depth
 * (2D) it opens a color-only pass and draws every segment on top.
 *
 * Each draw range is gated against `ctx.view.renderLayers`, so a segment
 * emitted on a layer the camera does not include is skipped — this is how
 * editor-only gizmos stay out of the game view.
 */
export const makeGizmoPassNode = (label: ReturnType<typeof createLabel>): ViewNode => ({
  label,
  __viewNode: true as const,
  input: (): readonly never[] => [],
  output: (): readonly never[] => [],
  run(ctx: NodeRunContext): void {
    const view = ctx.view;
    const encoder = ctx.encoder;
    if (view === undefined) {
      throw new Error('GizmoPassNode: ctx.view is undefined; this node must run inside a camera-driven sub-graph.');
    }
    if (encoder === undefined) {
      throw new Error('GizmoPassNode: ctx.encoder is undefined; the parent CameraDriverNode must open the frame encoder.');
    }
    const mesh = ctx.app.getResource(GizmoMesh);
    if (mesh === undefined || mesh.gpu.buffer === undefined || mesh.draws.length === 0) return;

    // Skip the whole pass if no range targets this camera's layers.
    let anyVisible = false;
    for (const range of mesh.draws) {
      if ((range.layerMask & view.renderLayers) !== 0) {
        anyVisible = true;
        break;
      }
    }
    if (!anyVisible) return;

    const colorTargetView = view.target.view;
    const colorAttachment: ColorAttachment = {
      view: colorTargetView,
      loadOp: 'load',
      storeOp: 'store',
    };
    const passDesc: RenderPassDescriptor = {
      label: `camera#${view.sourceEntity}.gizmo`,
      colorAttachments: [colorAttachment],
    };
    const depthFormat = view.depth ? view.depth.format : null;
    if (view.depth) {
      // Load the opaque depth and keep it. The gizmo pipelines never write depth
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
    const buffer = mesh.gpu.buffer;
    pass.setVertexBuffer(0, buffer);
    for (const range of mesh.draws) {
      if ((range.layerMask & view.renderLayers) === 0) continue;
      const depthTest = depthFormat !== null ? range.depthTest : false;
      pass.setPipeline(mesh.pipeline({ colorFormat: view.target.format, depthFormat, depthTest }));
      pass.draw(range.vertexCount, 1, range.firstVertex);
    }
    pass.end();
  },
});
