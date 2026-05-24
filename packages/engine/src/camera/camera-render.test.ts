import { describe, expect, it } from 'bun:test';

import type {
  BindGroup,
  BindGroupDescriptor,
  BindGroupLayout,
  BindGroupLayoutDescriptor,
  Buffer,
  BufferDescriptor,
  ColorAttachment,
  CommandBuffer,
  CommandEncoder,
  Renderer,
  RenderPassDescriptor,
  RenderPassEncoder,
  RenderTarget,
  ResolvedRenderTarget,
  Surface,
  TextureFormat,
  TextureView,
} from '@retro-engine/renderer-core';

import {
  App,
  Camera,
  Camera2d,
  CameraRenderTarget,
  ClearColorConfig,
  RenderCtx,
  RenderSet,
} from '../index';
import { makeStubCanvas } from '../test-utils';

interface CapturingRenderer {
  renderer: Renderer;
  beginPassCalls: RenderPassDescriptor[];
}

const fail = (msg: string): never => {
  throw new Error(`capturing renderer: ${msg} not implemented`);
};

const makeCapturingRenderer = (): CapturingRenderer => {
  const beginPassCalls: RenderPassDescriptor[] = [];
  const view: TextureView = { destroy: () => undefined };
  const pass: RenderPassEncoder = {
    setPipeline: () => undefined,
    setBindGroup: () => undefined,
    setVertexBuffer: () => undefined,
    setIndexBuffer: () => undefined,
    draw: () => undefined,
    drawIndexed: () => undefined,
    end: () => undefined,
  };
  const commandBuffer: CommandBuffer = { destroy: () => undefined };
  const encoder: CommandEncoder = {
    beginRenderPass: (descriptor: RenderPassDescriptor) => {
      // Deep-clone the descriptor's color attachments so subsequent in-place
      // mutations on the engine's scratch state don't poison our capture.
      beginPassCalls.push({
        ...(descriptor.label !== undefined ? { label: descriptor.label } : {}),
        colorAttachments: descriptor.colorAttachments.map((a) => ({ ...a })) as ColorAttachment[],
      });
      return pass;
    },
    finish: () => commandBuffer,
  };
  const surface: Surface = {
    configure: () => undefined,
    resize: () => undefined,
    getCurrentTextureView: () => view,
    get format(): TextureFormat {
      return 'rgba8unorm';
    },
    get width(): number {
      return 640;
    },
    get height(): number {
      return 480;
    },
    destroy: () => undefined,
  };
  const inertBindGroup: BindGroup = { destroy: () => undefined };
  const inertBindGroupLayout: BindGroupLayout = { destroy: () => undefined };
  const renderer: Renderer = {
    capabilities: {
      computeShaders: false,
      storageTextures: false,
      timestampQueries: false,
      indirectDraw: false,
      bgra8UnormStorage: false,
      baseVertex: true,
    },
    init: () => Promise.resolve(),
    destroy: () => undefined,
    getPreferredSurfaceFormat: (): TextureFormat => 'rgba8unorm',
    createSurface: () => surface,
    createShaderModule: () => fail('createShaderModule'),
    createBuffer: (descriptor: BufferDescriptor): Buffer => ({
      size: descriptor.size,
      usage: descriptor.usage,
      destroy: () => undefined,
    }),
    createTexture: () => fail('createTexture'),
    createSampler: () => fail('createSampler'),
    writeBuffer: () => undefined,
    writeTexture: () => fail('writeTexture'),
    createBindGroupLayout: (_descriptor: BindGroupLayoutDescriptor): BindGroupLayout => inertBindGroupLayout,
    createPipelineLayout: () => fail('createPipelineLayout'),
    createBindGroup: (_descriptor: BindGroupDescriptor): BindGroup => inertBindGroup,
    createRenderPipeline: () => fail('createRenderPipeline'),
    createCommandEncoder: () => encoder,
    resolveRenderTarget: (target: RenderTarget): ResolvedRenderTarget => {
      if (target.kind === 'surface') {
        return { view, format: 'rgba8unorm', width: 640, height: 480 };
      }
      return fail('resolveRenderTarget for non-surface targets');
    },
    submit: () => undefined,
  };
  return { renderer, beginPassCalls };
};

describe('Camera-driven render set (ADR-0020)', () => {
  it('opens one render pass per active camera per frame', async () => {
    const { renderer, beginPassCalls } = makeCapturingRenderer();
    const app = new App({ renderer, canvas: makeStubCanvas() });
    app.world.spawn(...Camera2d({ order: 0 }));
    app.world.spawn(...Camera2d({ order: 1 }));
    await app.run();
    expect(beginPassCalls).toHaveLength(2);
  });

  it('skips inactive cameras', async () => {
    const { renderer, beginPassCalls } = makeCapturingRenderer();
    const app = new App({ renderer, canvas: makeStubCanvas() });
    app.world.spawn(...Camera2d({ isActive: false }));
    app.world.spawn(...Camera2d());
    await app.run();
    expect(beginPassCalls).toHaveLength(1);
  });

  it('falls back to a single clear-only pass when no cameras are active and a surface exists', async () => {
    const { renderer, beginPassCalls } = makeCapturingRenderer();
    const app = new App({ renderer, canvas: makeStubCanvas() });
    await app.run();
    expect(beginPassCalls).toHaveLength(1);
    expect(beginPassCalls[0]?.label).toBe('fallback-clear');
    expect(beginPassCalls[0]?.colorAttachments[0]?.loadOp).toBe('clear');
  });

  it('runs Render-set systems once per camera, with a per-camera ctx.camera', async () => {
    const { renderer } = makeCapturingRenderer();
    const app = new App({ renderer, canvas: makeStubCanvas() });
    const c1 = app.world.spawn(...Camera2d({ order: 0 }));
    const c2 = app.world.spawn(...Camera2d({ order: 1 }));
    const sourceEntities: number[] = [];
    app.addSystem('render', [RenderCtx], (ctx) => {
      sourceEntities.push(ctx.camera.sourceEntity);
    });
    await app.run();
    expect(sourceEntities).toEqual([c1 as unknown as number, c2 as unknown as number]);
  });

  it('honors ClearColorConfig.None: loadOp is "load" and clearValue is absent', async () => {
    const { renderer, beginPassCalls } = makeCapturingRenderer();
    const app = new App({ renderer, canvas: makeStubCanvas() });
    app.world.spawn(...Camera2d({ clearColor: ClearColorConfig.None }));
    await app.run();
    expect(beginPassCalls).toHaveLength(1);
    expect(beginPassCalls[0]?.colorAttachments[0]?.loadOp).toBe('load');
    expect(beginPassCalls[0]?.colorAttachments[0]?.clearValue).toBeUndefined();
  });

  it('honors ClearColorConfig.custom: clearValue mirrors the configured color', async () => {
    const { renderer, beginPassCalls } = makeCapturingRenderer();
    const app = new App({ renderer, canvas: makeStubCanvas() });
    app.world.spawn(...Camera2d({
      clearColor: ClearColorConfig.custom({ r: 0.25, g: 0.5, b: 0.75, a: 1 }),
    }));
    await app.run();
    expect(beginPassCalls[0]?.colorAttachments[0]?.loadOp).toBe('clear');
    expect(beginPassCalls[0]?.colorAttachments[0]?.clearValue).toEqual({
      r: 0.25,
      g: 0.5,
      b: 0.75,
      a: 1,
    });
  });

  it('orders cameras by Camera.order ascending', async () => {
    const { renderer } = makeCapturingRenderer();
    const app = new App({ renderer, canvas: makeStubCanvas() });
    const c10 = app.world.spawn(...Camera2d({ order: 10 }));
    const c5 = app.world.spawn(...Camera2d({ order: 5 }));
    const c1 = app.world.spawn(...Camera2d({ order: 1 }));
    const ordered: number[] = [];
    app.addSystem('render', [RenderCtx], (ctx) => {
      ordered.push(ctx.camera.sourceEntity);
    }, { set: RenderSet.Render });
    await app.run();
    expect(ordered).toEqual([c1, c5, c10] as unknown as number[]);
  });

  it('does not extract cameras whose Primary target cannot be resolved (headless App)', async () => {
    const { renderer, beginPassCalls } = makeCapturingRenderer();
    const app = new App({ renderer }); // no canvas → no surface
    app.world.spawn(...Camera2d());
    await app.run();
    expect(beginPassCalls).toHaveLength(0);
  });

  it('ctx.camera.viewBindGroup is the same instance across frames for the same source entity', async () => {
    const { renderer } = makeCapturingRenderer();
    const app = new App({ renderer, canvas: makeStubCanvas() });
    app.world.spawn(...Camera2d());
    const seen: unknown[] = [];
    app.addSystem('render', [RenderCtx], (ctx) => {
      seen.push(ctx.camera.viewBindGroup);
    });
    await app.run();
    app.advanceFrame(16);
    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe(seen[1]);
  });
});

describe('Camera spawn surface', () => {
  it('Camera2d spawn yields one Camera + one OrthographicProjection + one Transform', () => {
    const app = new App({
      renderer: { ...makeCapturingRenderer().renderer },
      canvas: makeStubCanvas(),
    });
    const e = app.world.spawn(...Camera2d());
    expect(app.world.getComponent(e, Camera)).toBeDefined();
  });

  it('Camera defaults to primary target, active, order=0, ClearColorConfig.Default', () => {
    const c = new Camera();
    expect(c.isActive).toBe(true);
    expect(c.order).toBe(0);
    expect(c.target).toBe(CameraRenderTarget.Primary);
    expect(c.clearColor).toBe(ClearColorConfig.Default);
  });
});
