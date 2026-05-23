/// <reference types="@webgpu/types" />

import type {
  BindGroup,
  ColorAttachment,
  CommandBuffer,
  CommandEncoder,
  RenderPassDescriptor,
  RenderPassEncoder,
  RenderPipeline,
} from '@retro-engine/renderer-core';

import {
  GPU_BIND_GROUP,
  GPU_COMMAND_BUFFER,
  GPU_PIPELINE,
  GPU_VIEW,
  type InternalBindGroup,
  type InternalCommandBuffer,
  type InternalRenderPipeline,
  type InternalTextureView,
} from './symbols';

export const makeCommandEncoder = (encoder: GPUCommandEncoder): CommandEncoder => {
  return {
    beginRenderPass(descriptor: RenderPassDescriptor): RenderPassEncoder {
      const colorAttachments: GPURenderPassColorAttachment[] = descriptor.colorAttachments.map(
        toColorAttachment,
      );
      const passDesc: GPURenderPassDescriptor = { colorAttachments };
      if (descriptor.label !== undefined) passDesc.label = descriptor.label;
      return makeRenderPassEncoder(encoder.beginRenderPass(passDesc));
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
  const out: GPURenderPassColorAttachment = {
    view: (att.view as InternalTextureView)[GPU_VIEW],
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
    setBindGroup(index: number, group: BindGroup): void {
      pass.setBindGroup(index, (group as InternalBindGroup)[GPU_BIND_GROUP]);
    },
    draw(vertexCount: number, instanceCount?: number): void {
      pass.draw(vertexCount, instanceCount);
    },
    end(): void {
      pass.end();
    },
  };
};
