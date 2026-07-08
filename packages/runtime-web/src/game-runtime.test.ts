import { describe, expect, it } from 'bun:test';

import { AmbientLight, App, AssetPlugin, Scenes } from '@retro-engine/engine';
import { Gltfs } from '@retro-engine/gltf';
import type { Renderer } from '@retro-engine/renderer-core';

import { installGameRuntime } from './game-runtime';

// An inert `Renderer` — enough to construct an `App` and run every plugin's
// `build` (which only reads `capabilities` and allocates inert GPU objects).
const makeInertRenderer = (): Renderer =>
  ({
    capabilities: {
      computeShaders: false,
      storageTextures: false,
      timestampQueries: false,
      indirectDraw: false,
      bgra8UnormStorage: false,
      baseVertex: true,
      storageBuffers: true,
    },
    init: () => Promise.resolve(),
    destroy: () => undefined,
    getPreferredSurfaceFormat: () => 'rgba8unorm',
    createBuffer: (d: { size: number; usage: number }) => ({ ...d, destroy: () => undefined }),
    createTexture: (d: Record<string, unknown>) => ({
      ...d,
      createView: () => ({ destroy: () => undefined }),
      destroy: () => undefined,
    }),
    createSampler: () => ({ destroy: () => undefined }),
    createShaderModule: () => ({ destroy: () => undefined }),
    createBindGroupLayout: () => ({ destroy: () => undefined }),
    createPipelineLayout: () => ({ destroy: () => undefined }),
    createBindGroup: () => ({ destroy: () => undefined }),
    writeBuffer: () => undefined,
    writeTexture: () => undefined,
  }) as unknown as Renderer;

// installGameRuntime runs after the asset layer is wired (bootWebGame's wireAssets
// adds AssetPlugin before it), so ScenePlugin finds an AssetServer. Mirror that
// here with a source-less AssetPlugin (no I/O at build).
const makeApp = (): App => {
  const app = new App({ renderer: makeInertRenderer(), canvas: { tagName: 'CANVAS' } as unknown as HTMLCanvasElement });
  app.addPlugin(new AssetPlugin());
  return app;
};

describe('installGameRuntime', () => {
  it('installs the render + scene/asset baseline', () => {
    const app = makeApp();
    const material = installGameRuntime(app);

    // Render baseline: an ambient light resource is inserted.
    expect(app.getResource(AmbientLight)).toBeDefined();
    // Scene/asset runtime: the scene store and glTF handle store exist.
    expect(app.getResource(Scenes)).toBeDefined();
    expect(app.getResource(Gltfs)).toBeDefined();
    // The returned material plugin is registered (glTF materials map into it).
    expect(app.hasPlugin(material.name())).toBe(true);
  });

  it('is idempotent — a second call adds nothing and does not throw (guards)', () => {
    const app = makeApp();
    installGameRuntime(app);
    const ambient = app.getResource(AmbientLight);

    expect(() => installGameRuntime(app)).not.toThrow();
    // The guard left the original resource in place rather than re-inserting.
    expect(app.getResource(AmbientLight)).toBe(ambient);
  });

  it('yields to a plugin the project already registered', () => {
    const app = makeApp();
    // A project that composed its own scene stack: ScenePlugin present up front.
    // installGameRuntime must not re-add it (which would throw on the unique plugin).
    installGameRuntime(app);
    expect(app.hasPlugin('ScenePlugin')).toBe(true);
    expect(() => installGameRuntime(app)).not.toThrow();
  });
});
