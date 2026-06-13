/// <reference types="@webgpu/types" />

import { ImGuiImplWeb } from '@mori2003/jsimgui';
import type { Renderer, Surface, SurfaceOverlay } from '@retro-engine/renderer-core';

import {
  GPU_DEVICE,
  GPU_SURFACE_CONTEXT,
  type InternalRenderer,
  type InternalSurface,
} from './symbols';

/**
 * Create a WebGPU-backed {@link SurfaceOverlay} for the immediate-mode UI layer.
 *
 * Pass the WebGPU renderer the App was constructed with; the overlay reads its
 * `GPUDevice` once `init()` is called (after the renderer's own `init()` has
 * resolved). Each frame, the overlay composites onto the surface's current
 * texture with a load operation, so the engine's render is preserved beneath it.
 *
 * @param renderer The active WebGPU renderer.
 */
export const createImGuiOverlay = (renderer: Renderer): SurfaceOverlay => {
  let device: GPUDevice | undefined;

  return {
    async init(canvas: HTMLCanvasElement): Promise<void> {
      device = (renderer as InternalRenderer)[GPU_DEVICE];
      if (device === undefined) {
        throw new Error(
          'createImGuiOverlay: renderer has no device — call Renderer.init() before SurfaceOverlay.init()',
        );
      }
      await ImGuiImplWeb.Init({ canvas, device, backend: 'webgpu' });
    },

    beginFrame(): void {
      ImGuiImplWeb.BeginRender();
    },

    endFrame(surface: Surface): void {
      if (device === undefined) return;
      const context = (surface as InternalSurface)[GPU_SURFACE_CONTEXT];
      // Draw through a storage-format view (the swapchain format the UI backend
      // built its pipeline for), not the engine's sRGB view, so the render-pass
      // attachment format matches the pipeline.
      const view = context.getCurrentTexture().createView();
      const encoder = device.createCommandEncoder({ label: 'imgui-overlay' });
      const pass = encoder.beginRenderPass({
        label: 'imgui-overlay',
        colorAttachments: [{ view, loadOp: 'load', storeOp: 'store' }],
      });
      ImGuiImplWeb.EndRender(pass);
      pass.end();
      device.queue.submit([encoder.finish()]);
    },

    destroy(): void {
      device = undefined;
    },
  };
};
