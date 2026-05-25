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
