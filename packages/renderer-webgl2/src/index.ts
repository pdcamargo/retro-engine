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
    baseVertex: false,
    storageBuffers: false,
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

// `createImGuiOverlay` is intentionally NOT re-exported here: it pulls the
// editor-only `@mori2003/jsimgui` (a multi-MB WASM lib), and this index is on the
// shipped-game path (`bootWebGame` imports the renderer factory from it). Keeping
// it out of the module graph means game bundles never include ImGui. Editor / dev
// hosts import it from the `@retro-engine/renderer-webgl2/imgui` subpath instead
// (mirrors renderer-webgpu; ADR / TESTING-TODO parallel to the WebGPU change).
