/// <reference types="@webgpu/types" />

import type {
  Buffer,
  BufferDescriptor,
  Extent3D,
  ImageCopyTexture,
  ImageDataLayout,
  Sampler,
  SamplerDescriptor,
  Texture,
  TextureDescriptor,
  TextureView,
  TextureViewDescriptor,
} from '@retro-engine/renderer-core';

import {
  GPU_BUFFER,
  GPU_SAMPLER,
  GPU_TEXTURE,
  GPU_VIEW,
  type InternalBuffer,
  type InternalSampler,
  type InternalTexture,
  type InternalTextureView,
} from './symbols';

/**
 * Wrap a freshly-acquired `GPUTextureView` as an opaque HAL handle.
 *
 * Used by every site that produces a view — texture sub-views, swapchain
 * acquisitions, render-target resolution. Centralising the wrap means callers
 * never reach for the `GPU_VIEW` symbol directly.
 */
export const wrapTextureView = (view: GPUTextureView): TextureView => {
  const handle: InternalTextureView = {
    [GPU_VIEW]: view,
    destroy(): void {
      // GPUTextureView has no destroy(); rely on GC.
    },
  };
  return handle;
};

export const createBufferImpl = (device: GPUDevice, descriptor: BufferDescriptor): Buffer => {
  const desc: GPUBufferDescriptor = { size: descriptor.size, usage: descriptor.usage };
  if (descriptor.label !== undefined) desc.label = descriptor.label;
  if (descriptor.mappedAtCreation !== undefined) desc.mappedAtCreation = descriptor.mappedAtCreation;
  const buffer = device.createBuffer(desc);
  const handle: InternalBuffer = {
    size: descriptor.size,
    usage: descriptor.usage,
    [GPU_BUFFER]: buffer,
    destroy(): void {
      buffer.destroy();
    },
  };
  return handle;
};

export const writeBufferImpl = (
  device: GPUDevice,
  buffer: Buffer,
  bufferOffset: number,
  data: BufferSource,
): void => {
  const native = (buffer as InternalBuffer)[GPU_BUFFER];
  device.queue.writeBuffer(native, bufferOffset, data);
};

export const createTextureImpl = (device: GPUDevice, descriptor: TextureDescriptor): Texture => {
  const depthOrArrayLayers = descriptor.depthOrArrayLayers ?? 1;
  const mipLevelCount = descriptor.mipLevelCount ?? 1;
  const sampleCount = descriptor.sampleCount ?? 1;
  const desc: GPUTextureDescriptor = {
    size: { width: descriptor.width, height: descriptor.height, depthOrArrayLayers },
    format: descriptor.format,
    usage: descriptor.usage,
    mipLevelCount,
    sampleCount,
  };
  if (descriptor.label !== undefined) desc.label = descriptor.label;
  if (descriptor.dimension !== undefined) desc.dimension = descriptor.dimension;
  const texture = device.createTexture(desc);
  const handle: InternalTexture = {
    width: descriptor.width,
    height: descriptor.height,
    depthOrArrayLayers,
    format: descriptor.format,
    mipLevelCount,
    sampleCount,
    usage: descriptor.usage,
    [GPU_TEXTURE]: texture,
    createView(viewDescriptor?: TextureViewDescriptor): TextureView {
      return wrapTextureView(texture.createView(toGpuTextureViewDescriptor(viewDescriptor)));
    },
    destroy(): void {
      texture.destroy();
    },
  };
  return handle;
};

const toGpuTextureViewDescriptor = (
  descriptor: TextureViewDescriptor | undefined,
): GPUTextureViewDescriptor | undefined => {
  if (!descriptor) return undefined;
  const out: GPUTextureViewDescriptor = {};
  if (descriptor.label !== undefined) out.label = descriptor.label;
  if (descriptor.format !== undefined) out.format = descriptor.format;
  if (descriptor.dimension !== undefined) out.dimension = descriptor.dimension;
  if (descriptor.aspect !== undefined) out.aspect = descriptor.aspect;
  if (descriptor.baseMipLevel !== undefined) out.baseMipLevel = descriptor.baseMipLevel;
  if (descriptor.mipLevelCount !== undefined) out.mipLevelCount = descriptor.mipLevelCount;
  if (descriptor.baseArrayLayer !== undefined) out.baseArrayLayer = descriptor.baseArrayLayer;
  if (descriptor.arrayLayerCount !== undefined) out.arrayLayerCount = descriptor.arrayLayerCount;
  return out;
};

export const createSamplerImpl = (device: GPUDevice, descriptor?: SamplerDescriptor): Sampler => {
  const desc: GPUSamplerDescriptor = {};
  if (descriptor) {
    if (descriptor.label !== undefined) desc.label = descriptor.label;
    if (descriptor.addressModeU !== undefined) desc.addressModeU = descriptor.addressModeU;
    if (descriptor.addressModeV !== undefined) desc.addressModeV = descriptor.addressModeV;
    if (descriptor.addressModeW !== undefined) desc.addressModeW = descriptor.addressModeW;
    if (descriptor.magFilter !== undefined) desc.magFilter = descriptor.magFilter;
    if (descriptor.minFilter !== undefined) desc.minFilter = descriptor.minFilter;
    if (descriptor.mipmapFilter !== undefined) desc.mipmapFilter = descriptor.mipmapFilter;
    if (descriptor.lodMinClamp !== undefined) desc.lodMinClamp = descriptor.lodMinClamp;
    if (descriptor.lodMaxClamp !== undefined) desc.lodMaxClamp = descriptor.lodMaxClamp;
    if (descriptor.compare !== undefined) desc.compare = descriptor.compare;
    if (descriptor.maxAnisotropy !== undefined) desc.maxAnisotropy = descriptor.maxAnisotropy;
  }
  const sampler = device.createSampler(desc);
  const handle: InternalSampler = {
    [GPU_SAMPLER]: sampler,
    destroy(): void {
      // GPUSampler has no destroy(); rely on GC.
    },
  };
  return handle;
};

export const writeTextureImpl = (
  device: GPUDevice,
  destination: ImageCopyTexture,
  data: BufferSource,
  dataLayout: ImageDataLayout,
  size: Extent3D,
): void => {
  const native = (destination.texture as InternalTexture)[GPU_TEXTURE];
  const dst: GPUTexelCopyTextureInfo = { texture: native };
  if (destination.mipLevel !== undefined) dst.mipLevel = destination.mipLevel;
  if (destination.aspect !== undefined) dst.aspect = destination.aspect;
  if (destination.origin) {
    dst.origin = {
      x: destination.origin.x ?? 0,
      y: destination.origin.y ?? 0,
      z: destination.origin.z ?? 0,
    };
  }
  const layout: GPUTexelCopyBufferLayout = {};
  if (dataLayout.offset !== undefined) layout.offset = dataLayout.offset;
  if (dataLayout.bytesPerRow !== undefined) layout.bytesPerRow = dataLayout.bytesPerRow;
  if (dataLayout.rowsPerImage !== undefined) layout.rowsPerImage = dataLayout.rowsPerImage;
  const extent: GPUExtent3DDict = { width: size.width };
  if (size.height !== undefined) extent.height = size.height;
  if (size.depthOrArrayLayers !== undefined) extent.depthOrArrayLayers = size.depthOrArrayLayers;
  device.queue.writeTexture(dst, data, layout, extent);
};
