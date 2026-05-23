/// <reference types="@webgpu/types" />

import type {
  BindGroup,
  BindGroupLayout,
  Buffer,
  CommandBuffer,
  PipelineLayout,
  RenderPipeline,
  Sampler,
  ShaderModule,
  Texture,
  TextureView,
} from '@retro-engine/renderer-core';

/**
 * Internal symbol keys used to hide concrete `GPU*` handles behind the HAL
 * types. `GPU*` types must never leak past this package (CLAUDE.md §10).
 *
 * Each HAL handle is implemented as an interface that extends the public type
 * with a symbol-keyed `GPU*` property. The symbol is module-local, so external
 * code cannot read or fabricate the handle.
 */
export const GPU_MODULE = Symbol('webgpu.shaderModule');
export const GPU_PIPELINE = Symbol('webgpu.renderPipeline');
export const GPU_PIPELINE_LAYOUT = Symbol('webgpu.pipelineLayout');
export const GPU_BIND_GROUP_LAYOUT = Symbol('webgpu.bindGroupLayout');
export const GPU_BIND_GROUP = Symbol('webgpu.bindGroup');
export const GPU_BUFFER = Symbol('webgpu.buffer');
export const GPU_TEXTURE = Symbol('webgpu.texture');
export const GPU_VIEW = Symbol('webgpu.textureView');
export const GPU_SAMPLER = Symbol('webgpu.sampler');
export const GPU_COMMAND_BUFFER = Symbol('webgpu.commandBuffer');

export interface InternalShaderModule extends ShaderModule {
  readonly [GPU_MODULE]: GPUShaderModule;
}
export interface InternalRenderPipeline extends RenderPipeline {
  readonly [GPU_PIPELINE]: GPURenderPipeline;
}
export interface InternalPipelineLayout extends PipelineLayout {
  readonly [GPU_PIPELINE_LAYOUT]: GPUPipelineLayout;
}
export interface InternalBindGroupLayout extends BindGroupLayout {
  readonly [GPU_BIND_GROUP_LAYOUT]: GPUBindGroupLayout;
}
export interface InternalBindGroup extends BindGroup {
  readonly [GPU_BIND_GROUP]: GPUBindGroup;
}
export interface InternalBuffer extends Buffer {
  readonly [GPU_BUFFER]: GPUBuffer;
}
export interface InternalTexture extends Texture {
  readonly [GPU_TEXTURE]: GPUTexture;
}
export interface InternalTextureView extends TextureView {
  readonly [GPU_VIEW]: GPUTextureView;
}
export interface InternalSampler extends Sampler {
  readonly [GPU_SAMPLER]: GPUSampler;
}
export interface InternalCommandBuffer extends CommandBuffer {
  readonly [GPU_COMMAND_BUFFER]: GPUCommandBuffer;
}
