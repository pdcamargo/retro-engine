import { afterEach, describe, expect, it } from 'bun:test';

import type { App, PluginObject } from '@retro-engine/engine';
import type { ProjectDefinition } from '@retro-engine/project';
import type { Renderer } from '@retro-engine/renderer-core';

import { bootWebGame } from './boot';

// A `Renderer` whose factories are inert — enough to construct an `App` and run
// every plugin's `build` (which only reads `capabilities` and allocates inert
// GPU objects). The frame loop never runs here (`autoRun: false`), so surface /
// encoder / pipeline paths are never touched.
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

const withStubDocument = (canvasId: string): (() => void) => {
  const canvas = { tagName: 'CANVAS' } as unknown as HTMLCanvasElement;
  (globalThis as { document?: unknown }).document = {
    getElementById: (id: string) => (id === canvasId ? canvas : null),
  };
  return () => {
    delete (globalThis as { document?: unknown }).document;
  };
};

class SpyPlugin implements PluginObject {
  built = false;
  name(): string {
    return 'SpyPlugin';
  }
  build(): void {
    this.built = true;
  }
}

afterEach(() => {
  delete (globalThis as { document?: unknown }).document;
});

describe('bootWebGame', () => {
  it('creates a renderer against the resolved canvas and composes the App with the project plugins', async () => {
    const restore = withStubDocument('game');
    const spy = new SpyPlugin();
    const definition: ProjectDefinition = { plugins: [spy] };

    let receivedCanvas: HTMLCanvasElement | undefined;
    const renderer = makeInertRenderer();

    const app: App = await bootWebGame(definition, {
      createRenderer: (canvas) => {
        receivedCanvas = canvas;
        return renderer;
      },
      autoRun: false,
    });

    expect(app).toBeDefined();
    expect(app.renderer).toBe(renderer);
    expect(receivedCanvas?.tagName).toBe('CANVAS');
    expect(spy.built).toBe(true);
    restore();
  });

  it('resolves the default canvas id "game" when none is given', async () => {
    const restore = withStubDocument('game');
    let received: HTMLCanvasElement | undefined;
    await bootWebGame(
      { plugins: [] },
      {
        createRenderer: (canvas) => {
          received = canvas;
          return makeInertRenderer();
        },
        autoRun: false,
      },
    );
    expect(received?.tagName).toBe('CANVAS');
    restore();
  });
});
