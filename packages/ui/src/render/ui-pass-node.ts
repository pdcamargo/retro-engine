import { createLabel, type RenderLabel, type RenderNode } from '@retro-engine/engine';
import type { ColorAttachment, RenderPassDescriptor } from '@retro-engine/renderer-core';

import { UiPipeline } from './ui-pipeline';

/** Render-graph label for the in-game UI overlay pass. */
export const UiPassLabel: RenderLabel = createLabel('retro_ui::ui_pass');

/**
 * Build the top-level UI overlay {@link RenderNode}. It runs once per frame
 * (after every camera sub-graph has submitted), owns its own command encoder,
 * and draws the prepared UI quads onto the swapchain with `loadOp: 'load'` so
 * they composite over the rendered scene.
 */
export const makeUiPassNode = (): RenderNode => ({
  label: UiPassLabel,
  input: () => [],
  output: () => [],
  run: (ctx) => {
    const pipeline = ctx.app.getResource(UiPipeline);
    if (pipeline === undefined || pipeline.count === 0) return;
    const surface = ctx.app.getSurface();
    if (surface === undefined) return;
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
    const encoder = renderer.createCommandEncoder('ui-overlay');
    const colorAttachment: ColorAttachment = {
      view: surface.getCurrentTextureView(),
      loadOp: 'load',
      storeOp: 'store',
    };
    const passDesc: RenderPassDescriptor = { label: 'ui-overlay', colorAttachments: [colorAttachment] };
    const pass = encoder.beginRenderPass(passDesc);
    pass.setPipeline(renderPipeline);
    pass.setVertexBuffer(0, quadVertexBuffer);
    pass.setVertexBuffer(1, instanceBuffer);
    pass.setIndexBuffer(quadIndexBuffer, 'uint16');
    pass.drawIndexed(6, pipeline.count, 0, 0, 0);
    pass.end();
    renderer.submit([encoder.finish()]);
  },
});
