/**
 * Optional capabilities that may or may not be supported by a given backend.
 * Engine code must check these before using any feature gated on them — this
 * is how WebGL2-incompatible features are kept reachable from the engine layer.
 */
export interface RendererCapabilities {
  readonly computeShaders: boolean;
  readonly storageTextures: boolean;
  readonly timestampQueries: boolean;
  readonly indirectDraw: boolean;
  readonly bgra8UnormStorage: boolean;
}

/**
 * Top-level renderer instance. Created by a backend factory and passed into
 * the engine `App`.
 *
 * The renderer owns the GPU device and acts as a factory for all backend
 * resources (surfaces, shader modules, pipelines, encoders). Engine code
 * never touches backend-specific types directly — everything flows through
 * this interface.
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

  /** Build a render pipeline. The descriptor's color targets must match the surface the pipeline will draw into. */
  createRenderPipeline(descriptor: RenderPipelineDescriptor): RenderPipeline;

  /** Begin recording GPU commands. Encoders are one-shot — finish to a CommandBuffer, then submit. */
  createCommandEncoder(label?: string): CommandEncoder;

  /** Hand command buffers off to the GPU for execution. */
  submit(buffers: CommandBuffer[]): void;
}

/** A GPU buffer. Lifetime is managed by the caller via {@link Buffer.destroy}. */
export interface Buffer {
  readonly size: number;
  destroy(): void;
}

/** A 2D GPU texture. */
export interface Texture {
  readonly width: number;
  readonly height: number;
  destroy(): void;
}

/** A view onto a {@link Texture} (or a surface's current swapchain texture). */
export interface TextureView {
  destroy(): void;
}

export interface Sampler {
  destroy(): void;
}

export interface BindGroupLayout {
  destroy(): void;
}

export interface BindGroup {
  destroy(): void;
}

/** A compiled shader. */
export interface ShaderModule {
  destroy(): void;
}

export interface RenderPipeline {
  destroy(): void;
}

export interface ComputePipeline {
  destroy(): void;
}

/**
 * A presentable surface tied to a canvas. Must be configured before use.
 *
 * The renderer creates this; engine code drives it.
 */
export interface Surface {
  /** Apply (or re-apply) swapchain configuration. Required before {@link Surface.getCurrentTextureView}. */
  configure(descriptor: SurfaceConfiguration): void;

  /** Resize the backing canvas's swapchain to `width × height` pixels. No-op if unchanged. */
  resize(width: number, height: number): void;

  /** Acquire a view onto the swapchain's current texture. Valid for one frame; do not retain. */
  getCurrentTextureView(): TextureView;

  destroy(): void;
}

export interface SurfaceConfiguration {
  /** Swapchain texture format. Use {@link Renderer.getPreferredSurfaceFormat} unless you have a reason not to. */
  format: TextureFormat;
  /** How alpha is interpreted when compositing the canvas. Defaults to `'opaque'`. */
  alphaMode?: 'opaque' | 'premultiplied';
}

/** Records GPU commands. Encoders are short-lived; one per frame is typical. */
export interface CommandEncoder {
  beginRenderPass(descriptor: RenderPassDescriptor): RenderPassEncoder;
  /** Finalize recording and produce a buffer ready for submission. The encoder is unusable after this. */
  finish(): CommandBuffer;
}

export interface RenderPassEncoder {
  setPipeline(pipeline: RenderPipeline): void;
  setBindGroup(index: number, group: BindGroup): void;
  draw(vertexCount: number, instanceCount?: number): void;
  end(): void;
}

/** A finished, submittable batch of GPU commands. */
export interface CommandBuffer {
  destroy(): void;
}

export interface ShaderModuleDescriptor {
  code: string;
  label?: string;
}

/**
 * Describes the configuration of a render pipeline.
 *
 * Deliberately small for the first render path: vertex + optional fragment,
 * optional primitive topology, `'auto'` pipeline layout. Vertex buffer layouts,
 * blend state, depth/stencil, and explicit bind group layouts grow in later
 * milestones as features earn them.
 */
export interface RenderPipelineDescriptor {
  label?: string;
  /** Pipeline layout. Only `'auto'` is supported today; explicit layouts arrive with bind groups. */
  layout?: 'auto';
  vertex: VertexState;
  fragment?: FragmentState;
  primitive?: PrimitiveState;
}

export interface VertexState {
  module: ShaderModule;
  entryPoint: string;
}

export interface FragmentState {
  module: ShaderModule;
  entryPoint: string;
  targets: ColorTargetState[];
}

export interface ColorTargetState {
  format: TextureFormat;
}

export interface PrimitiveState {
  topology?: 'triangle-list' | 'triangle-strip' | 'line-list' | 'line-strip' | 'point-list';
}

export interface RenderPassDescriptor {
  label?: string;
  colorAttachments: ColorAttachment[];
}

export interface ColorAttachment {
  view: TextureView;
  loadOp: 'load' | 'clear';
  storeOp: 'store' | 'discard';
  /** Color used when `loadOp === 'clear'`. Defaults to transparent black if omitted. */
  clearValue?: ClearColor;
}

/** RGBA clear color, components in `[0, 1]`. Matches WebGPU's `GPUColorDict`. */
export interface ClearColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** Texture formats. Expand as the engine needs them. */
export type TextureFormat = 'rgba8unorm' | 'bgra8unorm' | 'rgba16float' | 'depth32float';
