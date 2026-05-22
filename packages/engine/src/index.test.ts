import { describe, expect, it } from 'bun:test';

import type {
  CommandBuffer,
  CommandEncoder,
  Renderer,
  RendererCapabilities,
  RenderPassEncoder,
  RenderPipeline,
  ShaderModule,
  Surface,
  TextureFormat,
  TextureView,
} from '@retro-engine/renderer-core';

import { App, RenderCtx, type RenderContext, Res, RunCondition } from './index';

const fail = (msg: string): never => {
  throw new Error(`stub renderer: ${msg} not implemented`);
};

const baseCapabilities: RendererCapabilities = {
  computeShaders: false,
  storageTextures: false,
  timestampQueries: false,
  indirectDraw: false,
  bgra8UnormStorage: false,
};

const makeHeadlessRenderer = (): Renderer => ({
  capabilities: baseCapabilities,
  init: () => Promise.resolve(),
  destroy: () => undefined,
  getPreferredSurfaceFormat: (): TextureFormat => 'rgba8unorm',
  createSurface: (): Surface => fail('createSurface'),
  createShaderModule: (): ShaderModule => fail('createShaderModule'),
  createRenderPipeline: (): RenderPipeline => fail('createRenderPipeline'),
  createCommandEncoder: (): CommandEncoder => fail('createCommandEncoder'),
  submit: (): void => fail('submit'),
});

/** Renderer + surface stubs that satisfy the frame-loop calls without doing GPU work. */
const makeRenderingRenderer = (): Renderer => {
  const view: TextureView = { destroy: () => undefined };
  const pass: RenderPassEncoder = {
    setPipeline: () => undefined,
    setBindGroup: () => undefined,
    draw: () => undefined,
    end: () => undefined,
  };
  const commandBuffer: CommandBuffer = { destroy: () => undefined };
  const encoder: CommandEncoder = {
    beginRenderPass: () => pass,
    finish: () => commandBuffer,
  };
  const surface: Surface = {
    configure: () => undefined,
    resize: () => undefined,
    getCurrentTextureView: () => view,
    destroy: () => undefined,
  };
  return {
    capabilities: baseCapabilities,
    init: () => Promise.resolve(),
    destroy: () => undefined,
    getPreferredSurfaceFormat: (): TextureFormat => 'rgba8unorm',
    createSurface: () => surface,
    createShaderModule: (): ShaderModule => fail('createShaderModule'),
    createRenderPipeline: (): RenderPipeline => fail('createRenderPipeline'),
    createCommandEncoder: () => encoder,
    submit: () => undefined,
  };
};

const makeStubCanvas = (): HTMLCanvasElement =>
  ({
    clientWidth: 640,
    clientHeight: 480,
    width: 0,
    height: 0,
  }) as unknown as HTMLCanvasElement;

describe('App', () => {
  it('accepts plugins and runs startup systems', async () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    let startupRan = 0;
    app.addPlugin((a) => {
      a.addSystem('startup', [], () => {
        startupRan += 1;
      });
    });
    await app.run();
    app.stop();
    expect(startupRan).toBe(1);
  });

  it('exposes a `World` for systems', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    const e = app.world.spawn();
    expect(app.world.has(e, Symbol.for('any'))).toBe(false);
  });

  it('skips the render stage when no canvas is provided', async () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    let renderRan = 0;
    app.addSystem('render', [], () => {
      renderRan += 1;
    });
    await app.run();
    app.stop();
    expect(renderRan).toBe(0);
  });
});

describe('System param protocol', () => {
  it('runs zero-param systems with empty params tuple', async () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    let updateRan = 0;
    app.addSystem('update', [], () => {
      updateRan += 1;
    });
    await app.run();
    app.stop();
    expect(updateRan).toBe(1);
  });

  it('injects a registered resource via Res(ctor)', async () => {
    class Score {
      value = 0;
    }
    const app = new App({ renderer: makeHeadlessRenderer() });
    app.insertResource(new Score());
    app.addSystem('update', [Res(Score)], (score) => {
      score.value = 7;
    });
    await app.run();
    app.stop();
    expect(app.getResource(Score)?.value).toBe(7);
  });

  it('resolves RenderCtx to the active frame context in render systems', async () => {
    const app = new App({ renderer: makeRenderingRenderer(), canvas: makeStubCanvas() });
    let received: RenderContext | undefined;
    app.addSystem('render', [RenderCtx], (ctx) => {
      received = ctx;
    });
    await app.run();
    app.stop();
    expect(received).toBeDefined();
    expect(received?.pass).toBeDefined();
    expect(received?.encoder).toBeDefined();
    expect(received?.surfaceView).toBeDefined();
  });

  it('skips a system whose runIf condition returns false', async () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    let ran = 0;
    app.addSystem(
      'update',
      [],
      () => {
        ran += 1;
      },
      { runIf: new RunCondition(() => false) },
    );
    await app.run();
    app.stop();
    expect(ran).toBe(0);
  });

  it('throws when a stage-scoped param is registered in the wrong stage', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    expect(() => app.addSystem('update', [RenderCtx], () => undefined)).toThrow();
  });
});
