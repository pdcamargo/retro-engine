// Test-only helpers for the glTF instantiation / plugin tests. Excluded from
// the shipped build (see tsconfig.build.json) — never import from src.

import type {
  BindGroup,
  Buffer,
  CommandBuffer,
  CommandEncoder,
  PipelineLayout,
  Renderer,
  RendererCapabilities,
  RenderPassEncoder,
  RenderPipeline,
  Sampler,
  Surface,
  Texture,
  TextureDescriptor,
  TextureFormat,
  TextureView,
} from '@retro-engine/renderer-core';

const capabilities: RendererCapabilities = {
  computeShaders: false,
  storageTextures: false,
  timestampQueries: false,
  indirectDraw: false,
  bgra8UnormStorage: false,
  baseVertex: true,
};

/**
 * A fully inert {@link Renderer}: every factory returns a do-nothing object and
 * every command is a no-op, so `App.advanceFrame()` runs end-to-end without a
 * GPU. Enough to drive the schedule (update reactor + postUpdate propagation)
 * in tests that assert ECS state rather than draws.
 */
export const makeStubRenderer = (): Renderer => {
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
    capabilities,
    init: () => Promise.resolve(),
    destroy: () => undefined,
    getPreferredSurfaceFormat: (): TextureFormat => 'rgba8unorm',
    createSurface: () => surface,
    createShaderModule: () => ({ destroy: () => undefined }),
    createBuffer: (descriptor): Buffer => ({
      size: descriptor.size,
      usage: descriptor.usage,
      destroy: () => undefined,
    }),
    createTexture: (descriptor): Texture => inertTexture(descriptor),
    createSampler: (): Sampler => ({ destroy: () => undefined }),
    writeBuffer: () => undefined,
    writeTexture: () => undefined,
    createBindGroupLayout: () => ({ destroy: () => undefined }),
    createPipelineLayout: (): PipelineLayout => ({ destroy: () => undefined }),
    createBindGroup: (): BindGroup => ({ destroy: () => undefined }),
    createRenderPipeline: (): RenderPipeline => ({ destroy: () => undefined }),
    createCommandEncoder: () => encoder,
    resolveRenderTarget: () => ({ view, format: 'rgba8unorm', width: 640, height: 480 }),
    submit: () => undefined,
  };
};
