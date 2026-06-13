import { ImGuiImplWeb } from '@mori2003/jsimgui';
import type { Renderer, Surface, SurfaceOverlay } from '@retro-engine/renderer-core';

/**
 * Create a WebGL2-backed {@link SurfaceOverlay} for the immediate-mode UI layer.
 *
 * The WebGL2 backend draws into the canvas's bound default framebuffer, so it
 * needs neither a device nor an explicit render target — `endFrame` composites
 * over whatever the engine last drew to the canvas this frame.
 *
 * @param _renderer The active WebGL2 renderer (unused; the backend binds to the
 *   canvas directly). Accepted for parity with the WebGPU overlay factory.
 */
export const createImGuiOverlay = (_renderer: Renderer): SurfaceOverlay => {
  return {
    async init(canvas: HTMLCanvasElement): Promise<void> {
      await ImGuiImplWeb.Init({ canvas, backend: 'webgl2' });
    },

    loadFont(name: string, data: Uint8Array): void {
      ImGuiImplWeb.LoadFont(name, data);
    },

    beginFrame(): void {
      ImGuiImplWeb.BeginRender();
    },

    endFrame(_surface: Surface): void {
      ImGuiImplWeb.EndRender();
    },

    destroy(): void {},
  };
};
