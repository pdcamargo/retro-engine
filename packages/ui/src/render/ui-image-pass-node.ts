import { createLabel, type RenderLabel, type RenderNode, RenderImages } from '@retro-engine/engine';
import type { ColorAttachment, RenderPassDescriptor } from '@retro-engine/renderer-core';

import { UiImagePipeline } from './ui-image-pipeline';

/** Render-graph label for the in-game UI image overlay pass. */
export const UiImagePassLabel: RenderLabel = createLabel('retro_ui::ui_image_pass');

/**
 * Build the UI image overlay {@link RenderNode}. Ordered after the UI quad pass
 * (so images composite over backgrounds) and before the text pass (so labels
 * draw over images); owns its encoder and draws the prepared image batches (one
 * per source texture) onto the swapchain with `loadOp: 'load'`.
 */
export const makeUiImagePassNode = (): RenderNode => ({
  label: UiImagePassLabel,
  input: () => [],
  output: () => [],
  run: (ctx) => {
    const pipeline = ctx.app.getResource(UiImagePipeline);
    if (pipeline === undefined || pipeline.count === 0) return;
    const surface = ctx.app.getSurface();
    if (surface === undefined) return;
    const renderImages = ctx.app.getResource(RenderImages);
    if (renderImages === undefined) return;
    const { pipeline: renderPipeline, quadVertexBuffer, quadIndexBuffer, instanceBuffer } = pipeline;
    if (
      renderPipeline === undefined ||
      quadVertexBuffer === undefined ||
      quadIndexBuffer === undefined ||
      instanceBuffer === undefined
    ) {
      return;
    }

    const renderer = ctx.app.renderer;
    const encoder = renderer.createCommandEncoder('ui-image');
    const colorAttachment: ColorAttachment = {
      view: surface.getCurrentTextureView(),
      loadOp: 'load',
      storeOp: 'store',
    };
    const passDesc: RenderPassDescriptor = { label: 'ui-image', colorAttachments: [colorAttachment] };
    const pass = encoder.beginRenderPass(passDesc);
    pass.setPipeline(renderPipeline);
    pass.setVertexBuffer(0, quadVertexBuffer);
    pass.setVertexBuffer(1, instanceBuffer);
    pass.setIndexBuffer(quadIndexBuffer, 'uint16');
    for (const batch of pipeline.batches) {
      const bindGroup = pipeline.bindGroupFor(batch.image, renderImages, renderer);
      if (bindGroup === undefined) continue;
      pass.setBindGroup(0, bindGroup);
      pass.drawIndexed(6, batch.count, 0, 0, batch.firstInstance);
    }
    pass.end();
    renderer.submit([encoder.finish()]);
  },
});
