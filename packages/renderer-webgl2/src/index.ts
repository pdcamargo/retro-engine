import type {
  BindGroup,
  BindGroupLayout,
  Buffer,
  CommandBuffer,
  CommandEncoder,
  PipelineLayout,
  Renderer,
  RendererCapabilities,
  RenderPipeline,
  ResolvedRenderTarget,
  Sampler,
  ShaderModule,
  Surface,
  Texture,
  TextureFormat,
} from '@retro-engine/renderer-core';

const NOT_IMPLEMENTED = 'WebGL2 backend is not implemented yet.';
const fail = (): never => {
  throw new Error(NOT_IMPLEMENTED);
};

/**
 * Create a WebGL2-backed renderer. Stub: every method throws. The package
 * exists so the contract surface stays in view and downstream code resolves
 * its types. Real implementation lands when the WebGL2 backend roadmap item
 * is scheduled.
 */
export const createWebGL2Renderer = (_canvas: HTMLCanvasElement): Renderer => {
  const capabilities: RendererCapabilities = {
    computeShaders: false,
    storageTextures: false,
    timestampQueries: false,
    indirectDraw: false,
    bgra8UnormStorage: false,
  };

  return {
    capabilities,
    init(): Promise<void> {
      return Promise.reject(new Error(NOT_IMPLEMENTED));
    },
    destroy(): void {
      fail();
    },
    getPreferredSurfaceFormat(): TextureFormat {
      return fail();
    },
    createSurface(): Surface {
      return fail();
    },
    createShaderModule(): ShaderModule {
      return fail();
    },
    createBuffer(): Buffer {
      return fail();
    },
    createTexture(): Texture {
      return fail();
    },
    createSampler(): Sampler {
      return fail();
    },
    writeBuffer(): void {
      fail();
    },
    writeTexture(): void {
      fail();
    },
    createBindGroupLayout(): BindGroupLayout {
      return fail();
    },
    createPipelineLayout(): PipelineLayout {
      return fail();
    },
    createBindGroup(): BindGroup {
      return fail();
    },
    createRenderPipeline(): RenderPipeline {
      return fail();
    },
    createCommandEncoder(): CommandEncoder {
      return fail();
    },
    resolveRenderTarget(): ResolvedRenderTarget {
      return fail();
    },
    submit(_buffers: readonly CommandBuffer[]): void {
      fail();
    },
  };
};
