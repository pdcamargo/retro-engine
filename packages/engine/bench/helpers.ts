// Shared bench scaffolding: headless renderer stub and silent logger so the
// `App` constructor and `propagateTransforms*` calls don't try to talk to a
// GPU or pollute the bench output with devWarn lines.

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

import type { Logger } from '@retro-engine/engine';

const fail = (msg: string): never => {
  throw new Error(`bench renderer: ${msg} not implemented`);
};

const baseCapabilities: RendererCapabilities = {
  computeShaders: false,
  storageTextures: false,
  timestampQueries: false,
  indirectDraw: false,
  bgra8UnormStorage: false,
  baseVertex: true,
};

/**
 * Inert renderer that returns no-op handles from the resource factories the
 * shader system touches — `createShaderModule`, `createRenderPipeline`,
 * `createPipelineLayout`. Used by `shader.bench.ts` so PipelineCache /
 * SpecializedRenderPipelines benchmarks exercise their own dedupe logic
 * without GPU-bound work and without throwing from the helper renderer.
 *
 * All non-shader factories still throw — accidental use is loud.
 */
export const makeShaderBenchRenderer = (): Renderer => ({
  capabilities: baseCapabilities,
  init: () => Promise.resolve(),
  destroy: () => undefined,
  getPreferredSurfaceFormat: (): TextureFormat => 'rgba8unorm',
  createSurface: (): Surface => fail('createSurface'),
  createShaderModule: (_descriptor: ShaderModuleDescriptor): ShaderModule => ({
    destroy: () => undefined,
  }),
  createBuffer: (_descriptor: BufferDescriptor): Buffer => fail('createBuffer'),
  createTexture: (_descriptor: TextureDescriptor): Texture => fail('createTexture'),
  createSampler: (_descriptor?: SamplerDescriptor): Sampler => fail('createSampler'),
  writeBuffer: (_buffer: Buffer, _offset: number, _data: BufferSource): void =>
    fail('writeBuffer'),
  writeTexture: (
    _destination: ImageCopyTexture,
    _data: BufferSource,
    _dataLayout: ImageDataLayout,
    _size: Extent3D,
  ): void => fail('writeTexture'),
  createBindGroupLayout: (_descriptor: BindGroupLayoutDescriptor): BindGroupLayout =>
    fail('createBindGroupLayout'),
  createPipelineLayout: (_descriptor: PipelineLayoutDescriptor): PipelineLayout => ({
    destroy: () => undefined,
  }),
  createBindGroup: (_descriptor: BindGroupDescriptor): BindGroup => fail('createBindGroup'),
  createRenderPipeline: (_descriptor: RenderPipelineDescriptor): RenderPipeline => ({
    destroy: () => undefined,
  }),
  createCommandEncoder: (_label?: string): CommandEncoder => fail('createCommandEncoder'),
  resolveRenderTarget: (_target: RenderTarget): ResolvedRenderTarget => fail('resolveRenderTarget'),
  submit: (_buffers: readonly CommandBuffer[]): void => fail('submit'),
});

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
 * Renderer stub for render-graph dispatch benches. Returns inert handles from
 * the resource factories `App.renderFrame()` + `CameraDriverNode` touch —
 * `createCommandEncoder`, `beginRenderPass`, `pass.end`, `submit`,
 * `resolveRenderTarget`, plus the buffer / bind-group factories
 * `CameraPlugin.prepareCameras` calls. Mirrors `test-utils.makeRenderingRenderer`;
 * kept here so bench helpers stay decoupled from test helpers.
 */
export const makeRenderingBenchRenderer = (): Renderer => {
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
    ): void => fail('writeTexture'),
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

export const makeStubBenchCanvas = (): HTMLCanvasElement =>
  ({
    clientWidth: 640,
    clientHeight: 480,
    width: 0,
    height: 0,
  }) as unknown as HTMLCanvasElement;

export const silentLogger: Logger = {
  error: () => {},
  warn: () => {},
  info: () => {},
  debug: () => {},
  devWarn: () => {},
  child(): Logger {
    return silentLogger;
  },
};
