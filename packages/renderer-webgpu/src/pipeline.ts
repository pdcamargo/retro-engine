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
  const desc: GPURenderPipelineDescriptor = {
    layout,
    vertex: { module: vertexModule, entryPoint: descriptor.vertex.entryPoint },
  };
  if (descriptor.label !== undefined) desc.label = descriptor.label;
  if (descriptor.fragment) {
    desc.fragment = {
      module: (descriptor.fragment.module as InternalShaderModule)[GPU_MODULE],
      entryPoint: descriptor.fragment.entryPoint,
      targets: descriptor.fragment.targets.map((t) => ({ format: t.format })),
    };
  }
  if (descriptor.primitive?.topology) {
    desc.primitive = { topology: descriptor.primitive.topology };
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
