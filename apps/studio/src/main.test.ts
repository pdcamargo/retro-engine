import { describe, expect, it } from 'bun:test';

import { App } from '@retro-engine/engine';
import { createWebGPURenderer } from '@retro-engine/renderer-webgpu';

describe('studio wiring', () => {
  it('constructs an App with the WebGPU renderer injected', () => {
    const canvas = {} as HTMLCanvasElement;
    const renderer = createWebGPURenderer(canvas);
    const app = new App({ renderer });
    expect(app.world).toBeDefined();
    expect(renderer.capabilities.computeShaders).toBe(true);
  });
});
