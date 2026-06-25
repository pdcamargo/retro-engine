// Test-only helpers shared by the engine's test suite. Excluded from the
// shipped package build via packages/engine/tsconfig.build.json — never import
// this from non-test source files.

import type {
  BindGroup,
  BindGroupDescriptor,
  BindGroupLayout,
  BindGroupLayoutDescriptor,
  Buffer,
  BufferDescriptor,
  CommandBuffer,
  CommandEncoder,
  Extent3D,
  ImageCopyTexture,
  ImageDataLayout,
  PipelineLayout,
  PipelineLayoutDescriptor,
  Renderer,
  RendererCapabilities,
  RenderPassEncoder,
  RenderPipeline,
  RenderPipelineDescriptor,
  RenderTarget,
  ResolvedRenderTarget,
  Sampler,
  SamplerDescriptor,
  ShaderModule,
  ShaderModuleDescriptor,
  Surface,
  Texture,
  TextureDescriptor,
  TextureFormat,
  TextureView,
} from '@retro-engine/renderer-core';

import type { App } from './index';
import {
  Core2dLabel,
  MainPassLabel,
  MainPassNode,
  RenderGraph,
  TransparentPass2dLabel,
} from './render-graph';

export const fail = (msg: string): never => {
  throw new Error(`stub renderer: ${msg} not implemented`);
};

export const baseCapabilities: RendererCapabilities = {
  computeShaders: false,
  storageTextures: false,
  timestampQueries: false,
  indirectDraw: false,
  bgra8UnormStorage: false,
  baseVertex: true,
  storageBuffers: true,
};

/**
 * A headless `Renderer` whose surface / encoder / pipeline factories throw.
 *
 * Intended for tests that exercise engine logic without touching the
 * render-pass machinery — `createSurface` / `createCommandEncoder` / `submit`
 * / `resolveRenderTarget` / `createRenderPipeline` all throw, signalling that
 * the test reached production rendering code paths.
 *
 * Plain resource factories (`createBuffer`, `createTexture`, `createSampler`,
 * `writeBuffer`, `writeTexture`, `createBindGroupLayout`,
 * `createPipelineLayout`, `createBindGroup`) return inert objects so the
 * engine-internal `MeshAllocator` / `ImagePlugin` / `MaterialPlugin` lifecycle
 * — which runs every frame from `CorePlugin` onwards — can complete without
 * a real GPU.
 */
export const makeHeadlessRenderer = (): Renderer => {
  const view: TextureView = { destroy: () => undefined };
  const inertBuffer = (size: number, usage: number): Buffer => ({
    size,
    usage,
    destroy: () => undefined,
  });
  const inertTexture = (descriptor: TextureDescriptor): Texture => ({
    width: descriptor.width,
    height: descriptor.height,
    depthOrArrayLayers: descriptor.depthOrArrayLayers ?? 1,
    format: descriptor.format,
    mipLevelCount: descriptor.mipLevelCount ?? 1,
    sampleCount: descriptor.sampleCount ?? 1,
    usage: descriptor.usage,
    createView: () => view,
    destroy: () => undefined,
  });
  return {
    capabilities: baseCapabilities,
    init: () => Promise.resolve(),
    destroy: () => undefined,
    getPreferredSurfaceFormat: (): TextureFormat => 'rgba8unorm',
    createSurface: (): Surface => fail('createSurface'),
    createShaderModule: (_descriptor: ShaderModuleDescriptor): ShaderModule => fail('createShaderModule'),
    createBuffer: (descriptor: BufferDescriptor): Buffer => inertBuffer(descriptor.size, descriptor.usage),
    createTexture: (descriptor: TextureDescriptor): Texture => inertTexture(descriptor),
    createSampler: (_descriptor?: SamplerDescriptor): Sampler => ({ destroy: () => undefined }),
    writeBuffer: (_buffer: Buffer, _offset: number, _data: BufferSource): void => undefined,
    writeTexture: (
      _destination: ImageCopyTexture,
      _data: BufferSource,
      _dataLayout: ImageDataLayout,
      _size: Extent3D,
    ): void => undefined,
    createBindGroupLayout: (_descriptor: BindGroupLayoutDescriptor): BindGroupLayout => ({ destroy: () => undefined }),
    createPipelineLayout: (_descriptor: PipelineLayoutDescriptor): PipelineLayout => ({ destroy: () => undefined }),
    createBindGroup: (_descriptor: BindGroupDescriptor): BindGroup => ({ destroy: () => undefined }),
    createRenderPipeline: (_descriptor: RenderPipelineDescriptor): RenderPipeline => fail('createRenderPipeline'),
    createCommandEncoder: (_label?: string): CommandEncoder => fail('createCommandEncoder'),
    resolveRenderTarget: (_target: RenderTarget): ResolvedRenderTarget => fail('resolveRenderTarget'),
    submit: (_buffers: readonly CommandBuffer[]): void => fail('submit'),
  };
};

/**
 * A `Renderer` stub that satisfies the frame-loop calls without doing GPU work.
 *
 * `createSurface`, `createCommandEncoder`, `submit`, `resolveRenderTarget`,
 * and the resource factories used by `CameraPlugin` + `MeshAllocator` +
 * `ImagePlugin` (`createBuffer`, `createBindGroupLayout`, `createBindGroup`,
 * `writeBuffer`, `createTexture`, `createSampler`, `writeTexture`) return
 * inert objects so `App.renderFrame()` can run end-to-end in tests.
 */
export const makeRenderingRenderer = (): Renderer => {
  const view: TextureView = { destroy: () => undefined };
  const pass: RenderPassEncoder = {
    setPipeline: () => undefined,
    setBindGroup: () => undefined,
    setVertexBuffer: () => undefined,
    setIndexBuffer: () => undefined,
    draw: () => undefined,
    drawIndexed: () => undefined,
    setStencilReference: () => undefined,
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
  const inertBuffer = (size: number, usage: number): Buffer => ({
    size,
    usage,
    destroy: () => undefined,
  });
  const inertBindGroupLayout: BindGroupLayout = { destroy: () => undefined };
  const inertBindGroup: BindGroup = { destroy: () => undefined };
  const inertTexture = (descriptor: TextureDescriptor): Texture => ({
    width: descriptor.width,
    height: descriptor.height,
    depthOrArrayLayers: descriptor.depthOrArrayLayers ?? 1,
    format: descriptor.format,
    mipLevelCount: descriptor.mipLevelCount ?? 1,
    sampleCount: descriptor.sampleCount ?? 1,
    usage: descriptor.usage,
    createView: () => view,
    destroy: () => undefined,
  });
  return {
    capabilities: baseCapabilities,
    init: () => Promise.resolve(),
    destroy: () => undefined,
    getPreferredSurfaceFormat: (): TextureFormat => 'rgba8unorm',
    createSurface: () => surface,
    createShaderModule: (_descriptor: ShaderModuleDescriptor): ShaderModule => ({
      destroy: () => undefined,
    }),
    createBuffer: (descriptor: BufferDescriptor): Buffer => inertBuffer(descriptor.size, descriptor.usage),
    createTexture: (descriptor: TextureDescriptor): Texture => inertTexture(descriptor),
    createSampler: (_descriptor?: SamplerDescriptor): Sampler => ({ destroy: () => undefined }),
    writeBuffer: (_buffer: Buffer, _offset: number, _data: BufferSource): void => undefined,
    writeTexture: (
      _destination: ImageCopyTexture,
      _data: BufferSource,
      _dataLayout: ImageDataLayout,
      _size: Extent3D,
    ): void => undefined,
    createBindGroupLayout: (_descriptor: BindGroupLayoutDescriptor): BindGroupLayout => inertBindGroupLayout,
    createPipelineLayout: (_descriptor: PipelineLayoutDescriptor): PipelineLayout => ({
      destroy: () => undefined,
    }),
    createBindGroup: (_descriptor: BindGroupDescriptor): BindGroup => inertBindGroup,
    createRenderPipeline: (_descriptor: RenderPipelineDescriptor): RenderPipeline => ({
      destroy: () => undefined,
    }),
    createCommandEncoder: () => encoder,
    resolveRenderTarget: (target: RenderTarget): ResolvedRenderTarget => {
      if (target.kind === 'surface') {
        return { view, format: 'rgba8unorm', width: 640, height: 480 };
      }
      return fail('resolveRenderTarget for non-surface targets');
    },
    submit: () => undefined,
  };
};

export const makeStubCanvas = (): HTMLCanvasElement =>
  ({
    clientWidth: 640,
    clientHeight: 480,
    width: 0,
    height: 0,
  }) as unknown as HTMLCanvasElement;

/**
 * Attach `MainPassNode` to the Core2d sub-graph so the legacy
 * `RenderSet.Render` + `RenderCtx` API has an open pass to run in. Phase 8.1
 * removed `MainPassNode` from the default Core2d sub-graph (replaced by the
 * `Opaque2d → Transparent2d` phase trio); tests that still exercise the
 * `RenderSet.Render` set call this between `App` construction and `app.run()`.
 *
 * Adds an edge so `MainPassNode` runs *after* the transparent pass — it then
 * opens a fresh pass against the same target. The label suffix `.main` lets
 * tests filter the resulting `beginRenderPass` calls when they need to.
 *
 * Intended for test code only. Production user code that needs the legacy
 * "open a pass and run every `RenderSet.Render` system" shape should register
 * its own custom sub-graph rather than mutate the engine default.
 */
export const attachLegacyMainPassToCore2d = (app: App): void => {
  const graph = app.getResource(RenderGraph);
  if (graph === undefined) {
    throw new Error(
      'attachLegacyMainPassToCore2d: RenderGraph resource missing; CorePlugin must have built before this call.',
    );
  }
  const sub = graph.getSubGraph(Core2dLabel);
  if (sub === undefined) {
    throw new Error(
      'attachLegacyMainPassToCore2d: Core2d sub-graph missing; RenderGraphPlugin must have built before this call.',
    );
  }
  sub.addNode(MainPassNode);
  sub.addEdge(TransparentPass2dLabel, MainPassLabel);
};

/**
 * One recorded pass on a {@link CapturedDrawLog}.
 */
export interface CapturedPass {
  /** The descriptor's `label`, when supplied. */
  label?: string | undefined;
  /** Recorded calls in the order they were issued against the pass encoder. */
  drawCalls: CapturedCall[];
}

/**
 * One recorded `RenderPassEncoder` interaction. The fields populated depend
 * on the call kind — `setPipeline` populates `pipeline`, `drawIndexed`
 * populates `drawIndexed`, etc.
 */
export interface CapturedCall {
  kind:
    | 'setPipeline'
    | 'setBindGroup'
    | 'setVertexBuffer'
    | 'setIndexBuffer'
    | 'draw'
    | 'drawIndexed'
    | 'setStencilReference';
  pipeline?: unknown;
  bindGroup?: { index: number; group: unknown };
  vertexBuffer?: { slot: number; buffer: unknown; offset?: number };
  indexBuffer?: { buffer: unknown; format: 'uint16' | 'uint32' };
  draw?: {
    vertexCount: number;
    instanceCount: number;
    firstVertex: number;
    firstInstance: number;
  };
  drawIndexed?: {
    indexCount: number;
    instanceCount: number;
    firstIndex: number;
    baseVertex: number;
    firstInstance: number;
  };
  stencilReference?: number;
}

/**
 * Capture log surfaced by {@link makeCapturingRenderer}. Resolves after each
 * `App.advanceFrame()` call — inspect `passes` to assert how many passes ran,
 * what each was labelled, and what draws / bind-group sets / buffer binds
 * each emitted.
 */
export interface CapturedDrawLog {
  passes: CapturedPass[];
}

/**
 * `Renderer` stub that records every `RenderPassEncoder` call onto the
 * returned {@link CapturedDrawLog}. Identical to {@link makeRenderingRenderer}
 * for resource factories — same inert objects — but the pass encoder writes
 * each interaction into the log so tests can assert "the queue produced
 * exactly N instanced draws" or "the bind group at `@group(1)` differs
 * between the two batches."
 *
 * The pass encoder records into the *currently open* pass; `beginRenderPass`
 * opens a new entry, and any subsequent draw calls land on that entry until
 * `end()` is called. Multiple passes per frame produce multiple entries in
 * insertion order.
 *
 * @example
 * ```ts
 * const { renderer, log } = makeCapturingRenderer();
 * const app = new App({ renderer });
 * // ... register plugins, spawn entities ...
 * app.advanceFrame();
 * expect(log.passes.length).toBeGreaterThan(0);
 * const opaque2d = log.passes.find((p) => p.label?.endsWith('.opaque2d'));
 * expect(opaque2d?.drawCalls.filter((c) => c.kind === 'drawIndexed')).toHaveLength(2);
 * ```
 */
export const makeCapturingRenderer = (): {
  renderer: Renderer;
  log: CapturedDrawLog;
} => {
  const log: CapturedDrawLog = { passes: [] };
  let currentPass: CapturedPass | undefined;
  const view: TextureView = { destroy: () => undefined };
  const pass: RenderPassEncoder = {
    setPipeline(pipeline) {
      currentPass?.drawCalls.push({ kind: 'setPipeline', pipeline });
    },
    setBindGroup(index, group) {
      currentPass?.drawCalls.push({
        kind: 'setBindGroup',
        bindGroup: { index, group },
      });
    },
    setVertexBuffer(slot, buffer, offset) {
      const entry: CapturedCall = {
        kind: 'setVertexBuffer',
        vertexBuffer: { slot, buffer },
      };
      if (offset !== undefined) entry.vertexBuffer!.offset = offset;
      currentPass?.drawCalls.push(entry);
    },
    setIndexBuffer(buffer, format) {
      currentPass?.drawCalls.push({
        kind: 'setIndexBuffer',
        indexBuffer: { buffer, format },
      });
    },
    draw(vertexCount, instanceCount = 1, firstVertex = 0, firstInstance = 0) {
      currentPass?.drawCalls.push({
        kind: 'draw',
        draw: { vertexCount, instanceCount, firstVertex, firstInstance },
      });
    },
    drawIndexed(
      indexCount,
      instanceCount = 1,
      firstIndex = 0,
      baseVertex = 0,
      firstInstance = 0,
    ) {
      currentPass?.drawCalls.push({
        kind: 'drawIndexed',
        drawIndexed: {
          indexCount,
          instanceCount,
          firstIndex,
          baseVertex,
          firstInstance,
        },
      });
    },
    setStencilReference(reference) {
      currentPass?.drawCalls.push({
        kind: 'setStencilReference',
        stencilReference: reference,
      });
    },
    end() {
      currentPass = undefined;
    },
  };
  const commandBuffer: CommandBuffer = { destroy: () => undefined };
  const encoder: CommandEncoder = {
    beginRenderPass(descriptor) {
      const entry: CapturedPass = { drawCalls: [] };
      if (descriptor.label !== undefined) entry.label = descriptor.label;
      log.passes.push(entry);
      currentPass = entry;
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
  const inertBuffer = (size: number, usage: number): Buffer => ({
    size,
    usage,
    destroy: () => undefined,
  });
  const inertBindGroupLayout: BindGroupLayout = { destroy: () => undefined };
  const inertTexture = (descriptor: TextureDescriptor): Texture => ({
    width: descriptor.width,
    height: descriptor.height,
    depthOrArrayLayers: descriptor.depthOrArrayLayers ?? 1,
    format: descriptor.format,
    mipLevelCount: descriptor.mipLevelCount ?? 1,
    sampleCount: descriptor.sampleCount ?? 1,
    usage: descriptor.usage,
    createView: () => view,
    destroy: () => undefined,
  });
  let nextBindGroupId = 0;
  const renderer: Renderer = {
    capabilities: baseCapabilities,
    init: () => Promise.resolve(),
    destroy: () => undefined,
    getPreferredSurfaceFormat: (): TextureFormat => 'rgba8unorm',
    createSurface: () => surface,
    createShaderModule: (_descriptor: ShaderModuleDescriptor): ShaderModule => ({
      destroy: () => undefined,
    }),
    createBuffer: (descriptor: BufferDescriptor): Buffer =>
      inertBuffer(descriptor.size, descriptor.usage),
    createTexture: (descriptor: TextureDescriptor): Texture => inertTexture(descriptor),
    createSampler: (_descriptor?: SamplerDescriptor): Sampler => ({
      destroy: () => undefined,
    }),
    writeBuffer: (_buffer: Buffer, _offset: number, _data: BufferSource): void => undefined,
    writeTexture: (
      _destination: ImageCopyTexture,
      _data: BufferSource,
      _dataLayout: ImageDataLayout,
      _size: Extent3D,
    ): void => undefined,
    createBindGroupLayout: (_descriptor: BindGroupLayoutDescriptor): BindGroupLayout =>
      inertBindGroupLayout,
    createPipelineLayout: (_descriptor: PipelineLayoutDescriptor): PipelineLayout => ({
      destroy: () => undefined,
    }),
    // Fresh identity per bind group — tests assert that two batches with
    // different images produce *distinct* bind groups, so each createBindGroup
    // call returns a unique object.
    createBindGroup: (_descriptor: BindGroupDescriptor): BindGroup => {
      const id = nextBindGroupId++;
      return { id, destroy: () => undefined } as BindGroup & { id: number };
    },
    createRenderPipeline: (_descriptor: RenderPipelineDescriptor): RenderPipeline => ({
      destroy: () => undefined,
    }),
    createCommandEncoder: () => encoder,
    resolveRenderTarget: (target: RenderTarget): ResolvedRenderTarget => {
      if (target.kind === 'surface') {
        return { view, format: 'rgba8unorm', width: 640, height: 480 };
      }
      return fail('resolveRenderTarget for non-surface targets');
    },
    submit: () => undefined,
  };
  return { renderer, log };
};
