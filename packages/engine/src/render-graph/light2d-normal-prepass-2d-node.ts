import type { Entity } from '@retro-engine/ecs';
import type { ColorAttachment, RenderPassDescriptor } from '@retro-engine/renderer-core';

import { Images } from '../image/images';
import { RenderImages } from '../image/image-plugin';
import { Light2dNormalState } from '../light2d/light-2d-normal';
import { ViewLight2dTargets } from '../light2d/light-2d-targets';
import { SpritePipeline } from '../sprite';

import { Core2dLabel } from './core-2d';
import type { NodeRunContext, ViewNode } from './node';
import { createLabel } from './render-label';

/**
 * Label for the Phase 9 normal-prepass node. Inserted by `Light2dPlugin` into
 * the Core2d sub-graph, ordered before the shadow + accumulation passes.
 */
export const Light2dNormalPrepass2dLabel = createLabel('light2d_normal_prepass_2d');

/**
 * Core2d node that captures normal-mapped sprites into the per-camera normal
 * G-buffer the accumulation pass samples for `N·L` shading.
 *
 * Runs per camera (the buffer is screen-space): clears the normal target to the
 * flat encoded normal `(0,0,1)` so un-mapped surfaces face the viewer, then —
 * when normal mapping is enabled and there are normal-mapped sprites — draws
 * each through the normal pipeline (sprite geometry + `fs_normal`), binding the
 * sprite's normal map. The pipeline + instance data are reused from
 * `Light2dNormalState`; the quad buffers + per-image bind group come from
 * `SpritePipeline`.
 *
 * Skips (without opening a pass) when this camera has no lighting target, or
 * when the sprite / normal pipelines aren't ready yet.
 */
export const Light2dNormalPrepass2dNode: ViewNode = {
  label: Light2dNormalPrepass2dLabel,
  __viewNode: true as const,
  input: (): readonly never[] => [],
  output: (): readonly never[] => [],
  run(ctx: NodeRunContext): void {
    const view = ctx.view;
    const encoder = ctx.encoder;
    if (view === undefined) {
      throw new Error(
        'Light2dNormalPrepass2dNode: ctx.view is undefined; this node must run inside a camera-driven sub-graph.',
      );
    }
    if (encoder === undefined) {
      throw new Error(
        'Light2dNormalPrepass2dNode: ctx.encoder is undefined; the parent CameraDriverNode must open the frame encoder.',
      );
    }
    if (view.subGraph !== Core2dLabel) return;

    const entry = ctx.app.getResource(ViewLight2dTargets)?.perCamera.get(view.sourceEntity as Entity);
    if (entry === undefined || entry.normalView === undefined) return;

    const colorAttachment: ColorAttachment = {
      view: entry.normalView,
      loadOp: 'clear',
      storeOp: 'store',
      // Flat encoded normal (0, 0, 1): un-mapped pixels face the viewer.
      clearValue: { r: 0.5, g: 0.5, b: 1, a: 1 },
    };
    const passDesc: RenderPassDescriptor = {
      label: `camera#${view.sourceEntity}.light2d_normal`,
      colorAttachments: [colorAttachment],
    };
    const pass = encoder.beginRenderPass(passDesc);

    const normal = ctx.app.getResource(Light2dNormalState);
    const sprite = ctx.app.getResource(SpritePipeline);
    const images = ctx.app.getResource(Images);
    const renderImages = ctx.app.getResource(RenderImages);
    if (
      normal !== undefined &&
      normal.enabled &&
      normal.draws.length > 0 &&
      normal.pipeline !== undefined &&
      normal.instanceBuffer !== undefined &&
      sprite !== undefined &&
      sprite.quadVertexBuffer !== undefined &&
      sprite.quadIndexBuffer !== undefined &&
      images !== undefined &&
      renderImages !== undefined
    ) {
      pass.setPipeline(normal.pipeline);
      pass.setBindGroup(0, view.viewBindGroup);
      pass.setVertexBuffer(0, sprite.quadVertexBuffer);
      pass.setVertexBuffer(1, normal.instanceBuffer);
      pass.setIndexBuffer(sprite.quadIndexBuffer, 'uint16');
      for (const draw of normal.draws) {
        const bind = sprite.bindGroupFor(draw.normalMap, images, renderImages, ctx.app.renderer);
        if (bind === undefined) continue;
        pass.setBindGroup(1, bind);
        pass.drawIndexed(6, draw.count, 0, 0, draw.firstInstance);
      }
    }
    pass.end();
  },
};
