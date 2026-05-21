/// <reference types="@webgpu/types" />

import type { Renderer, RendererCapabilities } from '@retro-engine/renderer-core';

/**
 * Create a WebGPU-backed renderer.
 *
 * Day-1 implementation acquires an adapter and `GPUDevice` during `init`.
 * Frame submission, resource creation, and surface configuration land as
 * engine features require them.
 *
 * @param _canvas Target canvas. Stored for later surface configuration; unused on day 1.
 */
export const createWebGPURenderer = (_canvas: HTMLCanvasElement): Renderer => {
  let device: GPUDevice | undefined;

  const capabilities: RendererCapabilities = {
    computeShaders: true,
    storageTextures: true,
    timestampQueries: false,
    indirectDraw: true,
    bgra8UnormStorage: false,
  };

  return {
    capabilities,
    async init(): Promise<void> {
      if (typeof navigator === 'undefined' || !navigator.gpu) {
        throw new Error('WebGPU is not available in this environment');
      }
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) throw new Error('No WebGPU adapter available');
      device = await adapter.requestDevice();
    },
    destroy(): void {
      device?.destroy();
      device = undefined;
    },
  };
};
