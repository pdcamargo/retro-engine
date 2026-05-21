import { describe, expect, it } from 'bun:test';

import type { Renderer, RendererCapabilities } from '@retro-engine/renderer-core';

import { App } from './index';

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
});
