import { describe, expect, it } from 'bun:test';

import type {
  CommandBuffer,
  CommandEncoder,
  Renderer,
  RendererCapabilities,
  RenderPipeline,
  ShaderModule,
  Surface,
  TextureFormat,
} from '@retro-engine/renderer-core';

import { App } from './index';

const fail = (msg: string): never => {
  throw new Error(`stub renderer: ${msg} not implemented`);
};

const makeStubRenderer = (): Renderer => {
  const capabilities: RendererCapabilities = {
    computeShaders: false,
    storageTextures: false,
    timestampQueries: false,
    indirectDraw: false,
    bgra8UnormStorage: false,
  };
  return {
    capabilities,
    init: () => Promise.resolve(),
    destroy: () => undefined,
    getPreferredSurfaceFormat: (): TextureFormat => 'rgba8unorm',
    createSurface: (): Surface => fail('createSurface'),
    createShaderModule: (): ShaderModule => fail('createShaderModule'),
    createRenderPipeline: (): RenderPipeline => fail('createRenderPipeline'),
    createCommandEncoder: (): CommandEncoder => fail('createCommandEncoder'),
    submit: (_buffers: CommandBuffer[]): void => fail('submit'),
  };
};

describe('App', () => {
  it('accepts plugins and runs startup systems', async () => {
    const app = new App({ renderer: makeStubRenderer() });
    let startupRan = 0;
    app.addPlugin((a) => {
      a.addSystem('startup', () => {
        startupRan += 1;
      });
    });
    await app.run();
    app.stop();
    expect(startupRan).toBe(1);
  });

  it('exposes a `World` for systems', () => {
    const app = new App({ renderer: makeStubRenderer() });
    const e = app.world.spawn();
    expect(app.world.has(e, Symbol.for('any'))).toBe(false);
  });

  it('skips the render stage when no canvas is provided', async () => {
    const app = new App({ renderer: makeStubRenderer() });
    let renderRan = 0;
    app.addSystem('render', () => {
      renderRan += 1;
    });
    await app.run();
    app.stop();
    expect(renderRan).toBe(0);
  });
});
