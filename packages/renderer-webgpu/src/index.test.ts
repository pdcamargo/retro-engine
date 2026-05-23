import { describe, expect, it } from 'bun:test';

import type { TextureView } from '@retro-engine/renderer-core';

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

  it('throws on resource factories before init()', () => {
    const canvas = {} as HTMLCanvasElement;
    const renderer = createWebGPURenderer(canvas);
    expect(() => renderer.createBuffer({ size: 64, usage: 0x40 })).toThrow('not initialized');
    expect(() => renderer.createTexture({ width: 1, height: 1, format: 'rgba8unorm', usage: 0x04 })).toThrow(
      'not initialized',
    );
    expect(() => renderer.createSampler()).toThrow('not initialized');
    expect(() => renderer.createBindGroupLayout({ entries: [] })).toThrow('not initialized');
    expect(() => renderer.createPipelineLayout({ bindGroupLayouts: [] })).toThrow('not initialized');
  });

  it('resolveRenderTarget passes the `view` variant through verbatim', () => {
    const canvas = {} as HTMLCanvasElement;
    const renderer = createWebGPURenderer(canvas);
    const stubView: TextureView = { destroy: () => undefined };
    const resolved = renderer.resolveRenderTarget({
      kind: 'view',
      view: stubView,
      format: 'bgra8unorm',
      width: 1024,
      height: 768,
    });
    expect(resolved.view).toBe(stubView);
    expect(resolved.format).toBe('bgra8unorm');
    expect(resolved.width).toBe(1024);
    expect(resolved.height).toBe(768);
  });
});
