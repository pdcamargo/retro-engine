/// <reference types="@webgpu/types" />

import type {
  BindGroup,
  BindGroupDescriptor,
  BindGroupEntry,
  BindGroupLayout,
  BindGroupLayoutDescriptor,
  BindGroupLayoutEntry,
  BufferBinding,
  PipelineLayout,
  PipelineLayoutDescriptor,
} from '@retro-engine/renderer-core';

import {
  GPU_BIND_GROUP,
  GPU_BIND_GROUP_LAYOUT,
  GPU_BUFFER,
  GPU_PIPELINE_LAYOUT,
  GPU_SAMPLER,
  GPU_VIEW,
  type InternalBindGroup,
  type InternalBindGroupLayout,
  type InternalBuffer,
  type InternalPipelineLayout,
  type InternalSampler,
  type InternalTextureView,
} from './symbols';

export const createBindGroupLayoutImpl = (
  device: GPUDevice,
  descriptor: BindGroupLayoutDescriptor,
): BindGroupLayout => {
  const desc: GPUBindGroupLayoutDescriptor = {
    entries: descriptor.entries.map(toGpuBindGroupLayoutEntry),
  };
  if (descriptor.label !== undefined) desc.label = descriptor.label;
  const layout = device.createBindGroupLayout(desc);
  const handle: InternalBindGroupLayout = {
    [GPU_BIND_GROUP_LAYOUT]: layout,
    destroy(): void {
      // GPUBindGroupLayout has no destroy(); rely on GC.
    },
  };
  return handle;
};

export const createPipelineLayoutImpl = (
  device: GPUDevice,
  descriptor: PipelineLayoutDescriptor,
): PipelineLayout => {
  const desc: GPUPipelineLayoutDescriptor = {
    bindGroupLayouts: descriptor.bindGroupLayouts.map(
      (l) => (l as InternalBindGroupLayout)[GPU_BIND_GROUP_LAYOUT],
    ),
  };
  if (descriptor.label !== undefined) desc.label = descriptor.label;
  const layout = device.createPipelineLayout(desc);
  const handle: InternalPipelineLayout = {
    [GPU_PIPELINE_LAYOUT]: layout,
    destroy(): void {
      // GPUPipelineLayout has no destroy(); rely on GC.
    },
  };
  return handle;
};

export const createBindGroupImpl = (device: GPUDevice, descriptor: BindGroupDescriptor): BindGroup => {
  const desc: GPUBindGroupDescriptor = {
    layout: (descriptor.layout as InternalBindGroupLayout)[GPU_BIND_GROUP_LAYOUT],
    entries: descriptor.entries.map(toGpuBindGroupEntry),
  };
  if (descriptor.label !== undefined) desc.label = descriptor.label;
  const group = device.createBindGroup(desc);
  const handle: InternalBindGroup = {
    [GPU_BIND_GROUP]: group,
    destroy(): void {
      // GPUBindGroup has no destroy(); rely on GC.
    },
  };
  return handle;
};

const isBufferBinding = (resource: unknown): resource is BufferBinding =>
  typeof resource === 'object' && resource !== null && 'buffer' in resource;

const toGpuBindGroupEntry = (entry: BindGroupEntry): GPUBindGroupEntry => {
  const r = entry.resource;
  if (isBufferBinding(r)) {
    const native: GPUBufferBinding = {
      buffer: (r.buffer as InternalBuffer)[GPU_BUFFER],
    };
    if (r.offset !== undefined) native.offset = r.offset;
    if (r.size !== undefined) native.size = r.size;
    return { binding: entry.binding, resource: native };
  }
  // Sampler and TextureView are both `{ destroy(): void }` at the HAL — the
  // backend tells them apart by which symbol-keyed property is present on the
  // concrete handle.
  if (GPU_SAMPLER in (r as object)) {
    return { binding: entry.binding, resource: (r as InternalSampler)[GPU_SAMPLER] };
  }
  if (GPU_VIEW in (r as object)) {
    return { binding: entry.binding, resource: (r as InternalTextureView)[GPU_VIEW] };
  }
  throw new Error(
    'WebGPU bind group entry: resource is not a BufferBinding, Sampler, or TextureView from this backend',
  );
};

const toGpuBindGroupLayoutEntry = (entry: BindGroupLayoutEntry): GPUBindGroupLayoutEntry => {
  const out: GPUBindGroupLayoutEntry = { binding: entry.binding, visibility: entry.visibility };
  if (entry.buffer) {
    const buffer: GPUBufferBindingLayout = {};
    if (entry.buffer.type !== undefined) buffer.type = entry.buffer.type;
    if (entry.buffer.hasDynamicOffset !== undefined) buffer.hasDynamicOffset = entry.buffer.hasDynamicOffset;
    if (entry.buffer.minBindingSize !== undefined) buffer.minBindingSize = entry.buffer.minBindingSize;
    out.buffer = buffer;
  }
  if (entry.sampler) {
    const sampler: GPUSamplerBindingLayout = {};
    if (entry.sampler.type !== undefined) sampler.type = entry.sampler.type;
    out.sampler = sampler;
  }
  if (entry.texture) {
    const texture: GPUTextureBindingLayout = {};
    if (entry.texture.sampleType !== undefined) texture.sampleType = entry.texture.sampleType;
    if (entry.texture.viewDimension !== undefined) texture.viewDimension = entry.texture.viewDimension;
    if (entry.texture.multisampled !== undefined) texture.multisampled = entry.texture.multisampled;
    out.texture = texture;
  }
  if (entry.storageTexture) {
    const storageTexture: GPUStorageTextureBindingLayout = {
      format: entry.storageTexture.format,
    };
    if (entry.storageTexture.access !== undefined) storageTexture.access = entry.storageTexture.access;
    if (entry.storageTexture.viewDimension !== undefined) {
      storageTexture.viewDimension = entry.storageTexture.viewDimension;
    }
    out.storageTexture = storageTexture;
  }
  return out;
};
