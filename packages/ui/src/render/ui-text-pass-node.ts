import { createLabel, type RenderLabel, type RenderNode, RenderImages } from '@retro-engine/engine';
import type { ColorAttachment, RenderPassDescriptor } from '@retro-engine/renderer-core';

import { UiTextPipeline } from './ui-text-pipeline';
import { uiTargetView } from './ui-render-target';

/** Render-graph label for the in-game UI text overlay pass. */
export const UiTextPassLabel: RenderLabel = createLabel('retro_ui::ui_text_pass');

/**
 * Build the UI text {@link RenderNode}. Ordered after the UI quad pass so glyphs
 * composite over backgrounds; owns its encoder and draws the prepared glyph
 * batches (one per font atlas) into the UI camera's render target with
 * `loadOp: 'load'`.
 */
export const makeUiTextPassNode = (): RenderNode => ({
  label: UiTextPassLabel,
  input: () => [],
  output: () => [],
  run: (ctx) => {
    const pipeline = ctx.app.getResource(UiTextPipeline);
    if (pipeline === undefined || pipeline.count === 0) return;
    const targetView = uiTargetView(ctx.app);
    if (targetView === undefined) return;
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
    const encoder = renderer.createCommandEncoder('ui-text');
    const colorAttachment: ColorAttachment = {
      view: targetView,
      loadOp: 'load',
      storeOp: 'store',
    };
    const passDesc: RenderPassDescriptor = { label: 'ui-text', colorAttachments: [colorAttachment] };
    const pass = encoder.beginRenderPass(passDesc);
    pass.setPipeline(renderPipeline);
    pass.setVertexBuffer(0, quadVertexBuffer);
    pass.setVertexBuffer(1, instanceBuffer);
    pass.setIndexBuffer(quadIndexBuffer, 'uint16');
    for (const batch of pipeline.batches) {
      const bindGroup = pipeline.bindGroupFor(batch.atlas, renderImages, renderer);
      if (bindGroup === undefined) continue;
      pass.setBindGroup(0, bindGroup);
      pass.drawIndexed(6, batch.count, 0, 0, batch.firstInstance);
    }
    pass.end();
    renderer.submit([encoder.finish()]);
  },
});
