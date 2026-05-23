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
};

export const makeHeadlessRenderer = (): Renderer => ({
  capabilities: baseCapabilities,
  init: () => Promise.resolve(),
  destroy: () => undefined,
  getPreferredSurfaceFormat: (): TextureFormat => 'rgba8unorm',
  createSurface: (): Surface => fail('createSurface'),
  createShaderModule: (_descriptor: ShaderModuleDescriptor): ShaderModule => fail('createShaderModule'),
  createBuffer: (_descriptor: BufferDescriptor): Buffer => fail('createBuffer'),
  createTexture: (_descriptor: TextureDescriptor): Texture => fail('createTexture'),
  createSampler: (_descriptor?: SamplerDescriptor): Sampler => fail('createSampler'),
  writeBuffer: (_buffer: Buffer, _offset: number, _data: BufferSource): void => fail('writeBuffer'),
  writeTexture: (
    _destination: ImageCopyTexture,
    _data: BufferSource,
    _dataLayout: ImageDataLayout,
    _size: Extent3D,
  ): void => fail('writeTexture'),
  createBindGroupLayout: (_descriptor: BindGroupLayoutDescriptor): BindGroupLayout =>
    fail('createBindGroupLayout'),
  createPipelineLayout: (_descriptor: PipelineLayoutDescriptor): PipelineLayout => fail('createPipelineLayout'),
  createBindGroup: (_descriptor: BindGroupDescriptor): BindGroup => fail('createBindGroup'),
  createRenderPipeline: (_descriptor: RenderPipelineDescriptor): RenderPipeline => fail('createRenderPipeline'),
  createCommandEncoder: (_label?: string): CommandEncoder => fail('createCommandEncoder'),
  resolveRenderTarget: (_target: RenderTarget): ResolvedRenderTarget => fail('resolveRenderTarget'),
  submit: (_buffers: readonly CommandBuffer[]): void => fail('submit'),
});

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
