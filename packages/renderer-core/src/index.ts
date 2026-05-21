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

/** Top-level renderer instance. Created by a backend factory and passed into the engine `App`. */
export interface Renderer {
  readonly capabilities: RendererCapabilities;
  init(): Promise<void>;
  destroy(): void;
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

export interface Sampler {
  destroy(): void;
}

export interface BindGroupLayout {
  destroy(): void;
}

export interface BindGroup {
  destroy(): void;
}

export interface RenderPipeline {
  destroy(): void;
}

export interface ComputePipeline {
  destroy(): void;
}

/** A presentable surface tied to a canvas or other render target. */
export interface Surface {
  resize(width: number, height: number): void;
  destroy(): void;
}

/** Records GPU commands. Encoders are short-lived; one per frame is typical. */
export interface CommandEncoder {
  beginRenderPass(): RenderPassEncoder;
  finish(): void;
}

export interface RenderPassEncoder {
  setPipeline(pipeline: RenderPipeline): void;
  setBindGroup(index: number, group: BindGroup): void;
  draw(vertexCount: number, instanceCount?: number): void;
  end(): void;
}

/** Common texture formats. Expand as the engine needs them. */
export type TextureFormat = 'rgba8unorm' | 'bgra8unorm' | 'rgba16float' | 'depth32float';
