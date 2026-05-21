import { describe, expect, it } from 'bun:test';

import { createWebGPURenderer } from './index';

describe('createWebGPURenderer', () => {
  it('returns a renderer with capability flags set', () => {
    const canvas = {} as HTMLCanvasElement;
    const renderer = createWebGPURenderer(canvas);
    expect(renderer.capabilities.computeShaders).toBe(true);
    expect(renderer.capabilities.timestampQueries).toBe(false);
  });

  it('rejects init() when WebGPU is unavailable', async () => {
    const canvas = {} as HTMLCanvasElement;
    const renderer = createWebGPURenderer(canvas);
    await expect(renderer.init()).rejects.toThrow();
  });
});
