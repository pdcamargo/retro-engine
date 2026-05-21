import type { Renderer, RendererCapabilities } from '@retro-engine/renderer-core';

const NOT_IMPLEMENTED = 'WebGL2 backend is not implemented yet.';

/**
 * Create a WebGL2-backed renderer. Stub: every method throws. The package
 * exists so the contract surface stays in view and downstream code resolves
 * its types. Real implementation lands when the WebGL2 backend roadmap item
 * is scheduled.
 */
export const createWebGL2Renderer = (_canvas: HTMLCanvasElement): Renderer => {
  const capabilities: RendererCapabilities = {
    computeShaders: false,
    storageTextures: false,
    timestampQueries: false,
    indirectDraw: false,
    bgra8UnormStorage: false,
  };

  return {
    capabilities,
    init(): Promise<void> {
      return Promise.reject(new Error(NOT_IMPLEMENTED));
    },
    destroy(): void {
      throw new Error(NOT_IMPLEMENTED);
    },
  };
};
