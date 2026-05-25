/// <reference types="@webgpu/types" />

import type {
  RenderPipeline,
  RenderPipelineDescriptor,
  ShaderModule,
  ShaderModuleDescriptor,
} from '@retro-engine/renderer-core';

import {
  GPU_MODULE,
  GPU_PIPELINE,
  GPU_PIPELINE_LAYOUT,
  type InternalPipelineLayout,
  type InternalRenderPipeline,
  type InternalShaderModule,
} from './symbols';

export const createShaderModuleImpl = (
  device: GPUDevice,
  descriptor: ShaderModuleDescriptor,
): ShaderModule => {
  const desc: GPUShaderModuleDescriptor = { code: descriptor.code };
  if (descriptor.label !== undefined) desc.label = descriptor.label;
  const module = device.createShaderModule(desc);
  const handle: InternalShaderModule = {
    [GPU_MODULE]: module,
    destroy(): void {
      // GPUShaderModule has no destroy(); rely on GC.
    },
  };
  return handle;
};

export const createRenderPipelineImpl = (
  device: GPUDevice,
  descriptor: RenderPipelineDescriptor,
): RenderPipeline => {
  const vertexModule = (descriptor.vertex.module as InternalShaderModule)[GPU_MODULE];
  const layout: GPURenderPipelineDescriptor['layout'] =
    descriptor.layout === undefined || descriptor.layout === 'auto'
      ? 'auto'
      : (descriptor.layout as InternalPipelineLayout)[GPU_PIPELINE_LAYOUT];
  const vertex: GPUVertexState = {
    module: vertexModule,
    entryPoint: descriptor.vertex.entryPoint,
  };
  if (descriptor.vertex.buffers && descriptor.vertex.buffers.length > 0) {
    vertex.buffers = descriptor.vertex.buffers.map((b) => {
      const layout: GPUVertexBufferLayout = {
        arrayStride: b.arrayStride,
        attributes: b.attributes.map((a) => ({
          shaderLocation: a.shaderLocation,
          format: a.format,
          offset: a.offset,
        })),
      };
      if (b.stepMode !== undefined) layout.stepMode = b.stepMode;
      return layout;
    });
  }
  const desc: GPURenderPipelineDescriptor = { layout, vertex };
  if (descriptor.label !== undefined) desc.label = descriptor.label;
  if (descriptor.fragment) {
    desc.fragment = {
      module: (descriptor.fragment.module as InternalShaderModule)[GPU_MODULE],
      entryPoint: descriptor.fragment.entryPoint,
      targets: descriptor.fragment.targets.map((t) => {
        const target: GPUColorTargetState = { format: t.format };
        if (t.blend) {
          target.blend = {
            color: {
              operation: t.blend.color.operation ?? 'add',
              srcFactor: t.blend.color.srcFactor ?? 'one',
              dstFactor: t.blend.color.dstFactor ?? 'zero',
            },
            alpha: {
              operation: t.blend.alpha.operation ?? 'add',
              srcFactor: t.blend.alpha.srcFactor ?? 'one',
              dstFactor: t.blend.alpha.dstFactor ?? 'zero',
            },
          };
        }
        if (t.writeMask !== undefined) target.writeMask = t.writeMask;
        return target;
      }),
    };
  }
  if (descriptor.primitive) {
    const primitive: GPUPrimitiveState = {};
    if (descriptor.primitive.topology !== undefined) primitive.topology = descriptor.primitive.topology;
    if (descriptor.primitive.cullMode !== undefined) primitive.cullMode = descriptor.primitive.cullMode;
    if (descriptor.primitive.frontFace !== undefined) primitive.frontFace = descriptor.primitive.frontFace;
    desc.primitive = primitive;
  }
  if (descriptor.depthStencil) {
    const ds = descriptor.depthStencil;
    const front = ds.stencilFront ?? {};
    const back = ds.stencilBack ?? {};
    desc.depthStencil = {
      format: ds.format,
      depthWriteEnabled: ds.depthWriteEnabled ?? true,
      depthCompare: ds.depthCompare ?? 'less',
      stencilFront: {
        compare: front.compare ?? 'always',
        failOp: front.failOp ?? 'keep',
        depthFailOp: front.depthFailOp ?? 'keep',
        passOp: front.passOp ?? 'keep',
      },
      stencilBack: {
        compare: back.compare ?? 'always',
        failOp: back.failOp ?? 'keep',
        depthFailOp: back.depthFailOp ?? 'keep',
        passOp: back.passOp ?? 'keep',
      },
      stencilReadMask: ds.stencilReadMask ?? 0xffffffff,
      stencilWriteMask: ds.stencilWriteMask ?? 0xffffffff,
      depthBias: ds.depthBias ?? 0,
      depthBiasSlopeScale: ds.depthBiasSlopeScale ?? 0,
      depthBiasClamp: ds.depthBiasClamp ?? 0,
    };
  }
  const pipeline = device.createRenderPipeline(desc);
  const handle: InternalRenderPipeline = {
    [GPU_PIPELINE]: pipeline,
    destroy(): void {
      // GPURenderPipeline has no destroy(); rely on GC.
    },
  };
  return handle;
};
