import type { DepthStencilAttachment, RenderPassDescriptor } from '@retro-engine/renderer-core';

import { Shadow3dState } from '../light3d/shadow-3d';

import { Core3dLabel } from './core-3d';
import type { NodeRunContext, ViewNode } from './node';
import { createLabel } from './render-label';

/**
 * Label for the Phase 10 shadow-atlas build node. Inserted by `Light3dPlugin`
 * into the Core3d sub-graph, ordered before `OpaquePass3dLabel`.
 */
export const Shadow3dPass3dLabel = createLabel('shadow_pass_3d');

/**
 * Core3d node rendering shadow-caster mesh depth from each shadow-casting
 * light's point of view into the shared depth atlas — one render pass per light
 * (atlas layer).
 *
 * The atlas is camera-independent (lights and casters are world-space), so it
 * is built once per frame: the first Core3d camera renders it, later cameras
 * see `builtThisFrame` and skip. Skips entirely when nothing casts a shadow
 * (no `Shadow3dState`, no shadow-casting lights, no casters, or the GPU
 * bootstrap is not yet complete).
 *
 * Each light's pass binds that light's light-space view-projection at
 * `@group(0)` and re-draws every caster batch with the depth-only pipeline.
 */
export const Shadow3dPass3dNode: ViewNode = {
  label: Shadow3dPass3dLabel,
  __viewNode: true as const,
  input: (): readonly never[] => [],
  output: (): readonly never[] => [],
  run(ctx: NodeRunContext): void {
    const view = ctx.view;
    const encoder = ctx.encoder;
    if (view === undefined) {
      throw new Error(
        'Shadow3dPass3dNode: ctx.view is undefined; this node must run inside a camera-driven sub-graph.',
      );
    }
    if (encoder === undefined) {
      throw new Error(
        'Shadow3dPass3dNode: ctx.encoder is undefined; the parent CameraDriverNode must open the frame encoder.',
      );
    }
    if (view.subGraph !== Core3dLabel) return;

    const shadow = ctx.app.getResource(Shadow3dState);
    if (shadow === undefined || shadow.builtThisFrame) return;
    // Mark built even on the no-caster early-out so other cameras don't retry.
    shadow.builtThisFrame = true;
    const instanceBuffer = shadow.instanceBuffer.buffer;
    if (
      shadow.shadowLightCount === 0 ||
      shadow.casterBatches.length === 0 ||
      instanceBuffer === undefined
    ) {
      return;
    }

    for (let layer = 0; layer < shadow.shadowLightCount; layer++) {
      const layerView = shadow.layerViews[layer];
      const layerBindGroup = shadow.layerBindGroups[layer];
      if (layerView === undefined || layerBindGroup === undefined) continue;

      const depthAttachment: DepthStencilAttachment = {
        view: layerView,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
        depthClearValue: 1.0,
      };
      const passDesc: RenderPassDescriptor = {
        label: `shadow3d_atlas_layer#${layer}`,
        colorAttachments: [],
        depthStencilAttachment: depthAttachment,
      };
      const pass = encoder.beginRenderPass(passDesc);
      pass.setBindGroup(0, layerBindGroup);
      for (const batch of shadow.casterBatches) {
        pass.setPipeline(batch.pipeline);
        pass.setVertexBuffer(0, batch.vertexSlice.buffer);
        pass.setVertexBuffer(1, instanceBuffer);
        const rm = batch.renderMesh;
        if (rm.bufferInfo.kind === 'indexed') {
          const idx = batch.indexSlice!;
          pass.setIndexBuffer(idx.buffer, rm.bufferInfo.indexFormat);
          pass.drawIndexed(
            rm.bufferInfo.indexCount,
            batch.count,
            idx.baseVertex,
            batch.vertexSlice.baseVertex,
            batch.firstInstance,
          );
        } else {
          pass.draw(rm.vertexCount, batch.count, batch.vertexSlice.baseVertex, batch.firstInstance);
        }
      }
      pass.end();
    }
  },
};
