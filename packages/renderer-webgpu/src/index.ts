/// <reference types="@webgpu/types" />

import type {
  BindGroup,
  ColorAttachment,
  CommandBuffer,
  CommandEncoder,
  RenderPassDescriptor,
  RenderPassEncoder,
  RenderPipeline,
  RenderPipelineDescriptor,
  Renderer,
  RendererCapabilities,
  ShaderModule,
  ShaderModuleDescriptor,
  Surface,
  SurfaceConfiguration,
  TextureFormat,
  TextureView,
} from '@retro-engine/renderer-core';

// Internal symbol keys used to hide concrete GPU* handles behind the HAL types.
// `GPU*` types must never leak past this package (CLAUDE.md §10).
const GPU_MODULE = Symbol('webgpu.shaderModule');
const GPU_PIPELINE = Symbol('webgpu.renderPipeline');
const GPU_VIEW = Symbol('webgpu.textureView');
const GPU_COMMAND_BUFFER = Symbol('webgpu.commandBuffer');

interface InternalShaderModule extends ShaderModule {
  readonly [GPU_MODULE]: GPUShaderModule;
}
interface InternalRenderPipeline extends RenderPipeline {
  readonly [GPU_PIPELINE]: GPURenderPipeline;
}
interface InternalTextureView extends TextureView {
  readonly [GPU_VIEW]: GPUTextureView;
}
interface InternalCommandBuffer extends CommandBuffer {
  readonly [GPU_COMMAND_BUFFER]: GPUCommandBuffer;
}

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
  };

  const requireDevice = (): GPUDevice => {
    if (!device) throw new Error('WebGPU renderer not initialized — call init() first');
    return device;
  };

  return {
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
      const dev = requireDevice();
      return makeSurface(dev, targetCanvas);
    },

    createShaderModule(descriptor: ShaderModuleDescriptor): ShaderModule {
      const dev = requireDevice();
      const moduleDesc: GPUShaderModuleDescriptor = { code: descriptor.code };
      if (descriptor.label !== undefined) moduleDesc.label = descriptor.label;
      const module = dev.createShaderModule(moduleDesc);
      const handle: InternalShaderModule = {
        [GPU_MODULE]: module,
        destroy(): void {
          // GPUShaderModule has no destroy(); rely on GC.
        },
      };
      return handle;
    },

    createRenderPipeline(descriptor: RenderPipelineDescriptor): RenderPipeline {
      const dev = requireDevice();
      const vertexModule = (descriptor.vertex.module as InternalShaderModule)[GPU_MODULE];
      const pipelineDesc: GPURenderPipelineDescriptor = {
        layout: descriptor.layout ?? 'auto',
        vertex: {
          module: vertexModule,
          entryPoint: descriptor.vertex.entryPoint,
        },
      };
      if (descriptor.label !== undefined) pipelineDesc.label = descriptor.label;
      if (descriptor.fragment) {
        pipelineDesc.fragment = {
          module: (descriptor.fragment.module as InternalShaderModule)[GPU_MODULE],
          entryPoint: descriptor.fragment.entryPoint,
          targets: descriptor.fragment.targets.map((t) => ({ format: t.format })),
        };
      }
      if (descriptor.primitive?.topology) {
        pipelineDesc.primitive = { topology: descriptor.primitive.topology };
      }
      const pipeline = dev.createRenderPipeline(pipelineDesc);
      const handle: InternalRenderPipeline = {
        [GPU_PIPELINE]: pipeline,
        destroy(): void {
          // GPURenderPipeline has no destroy(); rely on GC.
        },
      };
      return handle;
    },

    createCommandEncoder(label?: string): CommandEncoder {
      const dev = requireDevice();
      const encoderDesc: GPUCommandEncoderDescriptor = {};
      if (label !== undefined) encoderDesc.label = label;
      const encoder = dev.createCommandEncoder(encoderDesc);
      return makeCommandEncoder(encoder);
    },

    submit(buffers: CommandBuffer[]): void {
      const dev = requireDevice();
      dev.queue.submit(buffers.map((b) => (b as InternalCommandBuffer)[GPU_COMMAND_BUFFER]));
    },
  };
};

const makeSurface = (device: GPUDevice, canvas: HTMLCanvasElement): Surface => {
  const context = canvas.getContext('webgpu');
  if (!context) throw new Error('Canvas does not support a WebGPU context');

  return {
    configure(descriptor: SurfaceConfiguration): void {
      context.configure({
        device,
        format: descriptor.format,
        alphaMode: descriptor.alphaMode ?? 'opaque',
      });
    },
    resize(width: number, height: number): void {
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
    },
    getCurrentTextureView(): TextureView {
      const view = context.getCurrentTexture().createView();
      const handle: InternalTextureView = {
        [GPU_VIEW]: view,
        destroy(): void {
          // GPUTextureView has no destroy(); rely on GC.
        },
      };
      return handle;
    },
    destroy(): void {
      context.unconfigure();
    },
  };
};

const makeCommandEncoder = (encoder: GPUCommandEncoder): CommandEncoder => {
  return {
    beginRenderPass(descriptor: RenderPassDescriptor): RenderPassEncoder {
      const colorAttachments: GPURenderPassColorAttachment[] = descriptor.colorAttachments.map(
        toColorAttachment,
      );
      const passDesc: GPURenderPassDescriptor = { colorAttachments };
      if (descriptor.label !== undefined) passDesc.label = descriptor.label;
      const pass = encoder.beginRenderPass(passDesc);
      return makeRenderPassEncoder(pass);
    },
    finish(): CommandBuffer {
      const cb = encoder.finish();
      const handle: InternalCommandBuffer = {
        [GPU_COMMAND_BUFFER]: cb,
        destroy(): void {
          // GPUCommandBuffer has no destroy(); rely on GC.
        },
      };
      return handle;
    },
  };
};

const toColorAttachment = (att: ColorAttachment): GPURenderPassColorAttachment => {
  const view = (att.view as InternalTextureView)[GPU_VIEW];
  const out: GPURenderPassColorAttachment = {
    view,
    loadOp: att.loadOp,
    storeOp: att.storeOp,
  };
  if (att.clearValue) {
    out.clearValue = {
      r: att.clearValue.r,
      g: att.clearValue.g,
      b: att.clearValue.b,
      a: att.clearValue.a,
    };
  }
  return out;
};

const makeRenderPassEncoder = (pass: GPURenderPassEncoder): RenderPassEncoder => {
  return {
    setPipeline(pipeline: RenderPipeline): void {
      pass.setPipeline((pipeline as InternalRenderPipeline)[GPU_PIPELINE]);
    },
    setBindGroup(_index: number, _group: BindGroup): void {
      throw new Error('setBindGroup not implemented yet — bind groups arrive with sprite rendering');
    },
    draw(vertexCount: number, instanceCount?: number): void {
      pass.draw(vertexCount, instanceCount);
    },
    end(): void {
      pass.end();
    },
  };
};
