/// <reference types="@webgpu/types" />

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
  RenderPipeline,
  RenderPipelineDescriptor,
  RenderTarget,
  Renderer,
  RendererCapabilities,
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

import {
  createBindGroupImpl,
  createBindGroupLayoutImpl,
  createPipelineLayoutImpl,
} from './binding';
import { makeCommandEncoder } from './encoder';
import { createRenderPipelineImpl, createShaderModuleImpl } from './pipeline';
import { resolveRenderTargetImpl } from './render-target';
import {
  createBufferImpl,
  createSamplerImpl,
  createTextureImpl,
  writeBufferImpl,
  writeTextureImpl,
} from './resources';
import { makeSurface } from './surface';
import { GPU_COMMAND_BUFFER, GPU_DEVICE, type InternalCommandBuffer } from './symbols';

/**
 * Create a WebGPU-backed renderer.
 *
 * Acquires the adapter and `GPUDevice` during {@link Renderer.init}. All other
 * methods fail until `init()` resolves.
 *
 * @param _canvas Retained for future global-state hints; surfaces are created
 *   via {@link Renderer.createSurface} once `init()` has resolved.
 */
export const createWebGPURenderer = (_canvas: HTMLCanvasElement): Renderer => {
  let device: GPUDevice | undefined;

  const capabilities: RendererCapabilities = {
    computeShaders: true,
    storageTextures: true,
    timestampQueries: false,
    indirectDraw: true,
    bgra8UnormStorage: false,
    baseVertex: true,
    storageBuffers: true,
  };

  const requireDevice = (): GPUDevice => {
    if (!device) throw new Error('WebGPU renderer not initialized — call init() first');
    return device;
  };

  const renderer: Renderer = {
    capabilities,

    async init(): Promise<void> {
      if (typeof navigator === 'undefined' || !navigator.gpu) {
        throw new Error('WebGPU is not available in this environment');
      }
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) throw new Error('No WebGPU adapter available');
      device = await adapter.requestDevice();
    },

    destroy(): void {
      device?.destroy();
      device = undefined;
    },

    getPreferredSurfaceFormat(): TextureFormat {
      if (typeof navigator === 'undefined' || !navigator.gpu) {
        throw new Error('WebGPU is not available in this environment');
      }
      return navigator.gpu.getPreferredCanvasFormat() as TextureFormat;
    },

    createSurface(targetCanvas: HTMLCanvasElement): Surface {
      return makeSurface(requireDevice(), targetCanvas);
    },

    createShaderModule(descriptor: ShaderModuleDescriptor): ShaderModule {
      return createShaderModuleImpl(requireDevice(), descriptor);
    },

    createBuffer(descriptor: BufferDescriptor): Buffer {
      return createBufferImpl(requireDevice(), descriptor);
    },

    createTexture(descriptor: TextureDescriptor): Texture {
      return createTextureImpl(requireDevice(), descriptor);
    },

    createSampler(descriptor?: SamplerDescriptor): Sampler {
      return createSamplerImpl(requireDevice(), descriptor);
    },

    writeBuffer(buffer: Buffer, bufferOffset: number, data: BufferSource): void {
      writeBufferImpl(requireDevice(), buffer, bufferOffset, data);
    },

    writeTexture(
      destination: ImageCopyTexture,
      data: BufferSource,
      dataLayout: ImageDataLayout,
      size: Extent3D,
    ): void {
      writeTextureImpl(requireDevice(), destination, data, dataLayout, size);
    },

    createBindGroupLayout(descriptor: BindGroupLayoutDescriptor): BindGroupLayout {
      return createBindGroupLayoutImpl(requireDevice(), descriptor);
    },

    createPipelineLayout(descriptor: PipelineLayoutDescriptor): PipelineLayout {
      return createPipelineLayoutImpl(requireDevice(), descriptor);
    },

    createBindGroup(descriptor: BindGroupDescriptor): BindGroup {
      return createBindGroupImpl(requireDevice(), descriptor);
    },

    createRenderPipeline(descriptor: RenderPipelineDescriptor): RenderPipeline {
      return createRenderPipelineImpl(requireDevice(), descriptor);
    },

    createCommandEncoder(label?: string): CommandEncoder {
      const dev = requireDevice();
      const encoderDesc: GPUCommandEncoderDescriptor = {};
      if (label !== undefined) encoderDesc.label = label;
      return makeCommandEncoder(dev.createCommandEncoder(encoderDesc));
    },

    resolveRenderTarget(target: RenderTarget): ResolvedRenderTarget {
      return resolveRenderTargetImpl(target);
    },

    submit(buffers: readonly CommandBuffer[]): void {
      const dev = requireDevice();
      dev.queue.submit(buffers.map((b) => (b as InternalCommandBuffer)[GPU_COMMAND_BUFFER]));
    },
  };

  // Expose the post-init device to in-package consumers (the ImGui overlay)
  // without leaking it onto the public `Renderer` surface (CLAUDE.md §10). The
  // getter reflects the device once `init()` has resolved.
  Object.defineProperty(renderer, GPU_DEVICE, { get: (): GPUDevice | undefined => device });

  return renderer;
};

// `createImGuiOverlay` is intentionally NOT re-exported here: it pulls the
// editor-only `@mori2003/jsimgui` (a multi-MB WASM lib), and this index is on the
// shipped-game path (`bootWebGame` imports `createWebGPURenderer` from it). Keeping
// it out of the module graph means game bundles never include ImGui. Editor / dev
// hosts import it from the `@retro-engine/renderer-webgpu/imgui` subpath instead.

// The raw `GPUTexture` behind a HAL `Texture`, reachable via the `GPU_TEXTURE`
// symbol. Exposed so a host that drives an external GPU library directly (e.g.
// handing an offscreen render target to an ImGui image binding) can obtain the
// underlying handle. `GPU*` types still never appear on the public HAL surface.
export { GPU_TEXTURE, GPU_VIEW } from './symbols';
export type { InternalTexture, InternalTextureView } from './symbols';
