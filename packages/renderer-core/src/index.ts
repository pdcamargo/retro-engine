import type {
  BindGroup,
  BindGroupDescriptor,
  BindGroupLayout,
  BindGroupLayoutDescriptor,
  PipelineLayout,
  PipelineLayoutDescriptor,
} from './binding';
import type { RendererCapabilities } from './capabilities';
import type { CommandBuffer, CommandEncoder } from './encoder';
import type { TextureFormat } from './formats';
import type { RenderPipeline, RenderPipelineDescriptor } from './pipeline';
import type { RenderTarget, ResolvedRenderTarget } from './render-target';
import type {
  Buffer,
  BufferDescriptor,
  ImageCopyTexture,
  ImageDataLayout,
  Extent3D,
  Sampler,
  SamplerDescriptor,
  Texture,
  TextureDescriptor,
} from './resources';
import type { ShaderModule, ShaderModuleDescriptor } from './shader';
import type { Surface } from './surface';

/**
 * Top-level renderer instance. Created by a backend factory and passed into
 * the engine `App`.
 *
 * The renderer owns the GPU device and acts as a factory for all backend
 * resources — surfaces, buffers, textures, samplers, shader modules, bind
 * groups, pipelines, encoders. Engine code never touches backend-specific
 * types directly; everything flows through this interface.
 */
export interface Renderer {
  readonly capabilities: RendererCapabilities;

  /** Acquire adapter/device and prepare the backend. Must be called before any other method. */
  init(): Promise<void>;

  /** Release device resources. Renderer is unusable after this returns. */
  destroy(): void;

  /** Format the backend recommends for swapchain textures on the current system. */
  getPreferredSurfaceFormat(): TextureFormat;

  /** Create a presentable surface bound to a canvas. */
  createSurface(canvas: HTMLCanvasElement): Surface;

  /** Compile a shader from source code (WGSL for WebGPU; GLSL ES for the future WebGL2 backend). */
  createShaderModule(descriptor: ShaderModuleDescriptor): ShaderModule;

  /**
   * Allocate a GPU buffer.
   *
   * Usage flags ({@link BufferUsage}) determine which operations the buffer
   * supports — vertex input, uniform binding, copy destination, etc.
   */
  createBuffer(descriptor: BufferDescriptor): Buffer;

  /**
   * Allocate a GPU texture.
   *
   * `usage` ({@link TextureUsage}) determines whether the texture can be bound
   * to shaders, used as a render attachment, copied to/from, and so on.
   */
  createTexture(descriptor: TextureDescriptor): Texture;

  /** Create a texture sampler. */
  createSampler(descriptor?: SamplerDescriptor): Sampler;

  /**
   * Upload bytes into a buffer.
   *
   * The buffer must have been created with `BufferUsage.COPY_DST`. The data is
   * staged through the backend's queue and visible to subsequent submissions.
   */
  writeBuffer(buffer: Buffer, bufferOffset: number, data: BufferSource): void;

  /**
   * Upload bytes into a texture region.
   *
   * The destination texture must have been created with `TextureUsage.COPY_DST`.
   * `dataLayout.bytesPerRow` is required for any region wider than one
   * block-row.
   */
  writeTexture(destination: ImageCopyTexture, data: BufferSource, dataLayout: ImageDataLayout, size: Extent3D): void;

  /** Build a bind-group layout — the schema for a set of resource bindings. */
  createBindGroupLayout(descriptor: BindGroupLayoutDescriptor): BindGroupLayout;

  /** Build a pipeline layout from one or more bind-group layouts. */
  createPipelineLayout(descriptor: PipelineLayoutDescriptor): PipelineLayout;

  /** Build a bind group — a concrete set of resources matching a {@link BindGroupLayout}. */
  createBindGroup(descriptor: BindGroupDescriptor): BindGroup;

  /**
   * Build a render pipeline.
   *
   * The descriptor's color targets must match the surface (or render-target
   * format) the pipeline will draw into.
   */
  createRenderPipeline(descriptor: RenderPipelineDescriptor): RenderPipeline;

  /** Begin recording GPU commands. Encoders are one-shot — finish to a CommandBuffer, then submit. */
  createCommandEncoder(label?: string): CommandEncoder;

  /**
   * Resolve a {@link RenderTarget} for the current frame.
   *
   * Surface variants acquire a fresh swapchain view; texture variants build
   * (or re-use) a view per the descriptor; view variants pass through.
   */
  resolveRenderTarget(target: RenderTarget): ResolvedRenderTarget;

  /** Hand command buffers off to the GPU for execution. */
  submit(buffers: readonly CommandBuffer[]): void;
}

export type {
  BindGroup,
  BindGroupDescriptor,
  BindGroupEntry,
  BindGroupLayout,
  BindGroupLayoutDescriptor,
  BindGroupLayoutEntry,
  BindingResource,
  BufferBinding,
  BufferBindingLayout,
  PipelineLayout,
  PipelineLayoutDescriptor,
  SamplerBindingLayout,
  ShaderStageFlags,
  StorageTextureBindingLayout,
  TextureBindingLayout,
} from './binding';
export { ShaderStage } from './binding';

export type { RendererCapabilities } from './capabilities';

export type { ClearColor, IndexFormat, TextureFormat, VertexFormat } from './formats';
export { indexFormatByteSize, vertexFormatByteSize } from './formats';

export type {
  ColorAttachment,
  CommandBuffer,
  CommandEncoder,
  DepthStencilAttachment,
  RenderPassDescriptor,
  RenderPassEncoder,
} from './encoder';

export type {
  BlendComponent,
  BlendFactor,
  BlendOperation,
  BlendState,
  ColorTargetState,
  ColorWriteFlags,
  CompareFunction,
  ComputePipeline,
  CullMode,
  DepthStencilState,
  FragmentState,
  FrontFace,
  PrimitiveState,
  PrimitiveTopology,
  RenderPipeline,
  RenderPipelineDescriptor,
  StencilFaceState,
  StencilOperation,
  VertexAttribute,
  VertexBufferLayout,
  VertexState,
  VertexStepMode,
} from './pipeline';
export { ColorWrite } from './pipeline';

export type { RenderTarget, ResolvedRenderTarget } from './render-target';

export type {
  Buffer,
  BufferDescriptor,
  BufferUsageFlags,
  Extent3D,
  ImageCopyTexture,
  ImageDataLayout,
  Sampler,
  SamplerDescriptor,
  Texture,
  TextureDescriptor,
  TextureUsageFlags,
  TextureView,
  TextureViewDescriptor,
} from './resources';
export { BufferUsage, TextureUsage } from './resources';

export type { ShaderModule, ShaderModuleDescriptor } from './shader';

export type { Surface, SurfaceConfiguration } from './surface';
