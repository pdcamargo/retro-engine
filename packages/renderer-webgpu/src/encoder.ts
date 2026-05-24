/// <reference types="@webgpu/types" />

import type {
  BindGroup,
  Buffer,
  ColorAttachment,
  CommandBuffer,
  CommandEncoder,
  DepthStencilAttachment,
  IndexFormat,
  RenderPassDescriptor,
  RenderPassEncoder,
  RenderPipeline,
} from '@retro-engine/renderer-core';

import {
  GPU_BIND_GROUP,
  GPU_BUFFER,
  GPU_COMMAND_BUFFER,
  GPU_PIPELINE,
  GPU_VIEW,
  type InternalBindGroup,
  type InternalBuffer,
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
      if (descriptor.depthStencilAttachment !== undefined) {
        passDesc.depthStencilAttachment = toDepthStencilAttachment(descriptor.depthStencilAttachment);
      }
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

const toDepthStencilAttachment = (att: DepthStencilAttachment): GPURenderPassDepthStencilAttachment => {
  const out: GPURenderPassDepthStencilAttachment = {
    view: (att.view as InternalTextureView)[GPU_VIEW],
    depthLoadOp: att.depthLoadOp,
    depthStoreOp: att.depthStoreOp,
  };
  if (att.depthClearValue !== undefined) out.depthClearValue = att.depthClearValue;
  if (att.depthReadOnly !== undefined) out.depthReadOnly = att.depthReadOnly;
  return out;
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
    setVertexBuffer(slot: number, buffer: Buffer, offset?: number, size?: number): void {
      const native = (buffer as InternalBuffer)[GPU_BUFFER];
      pass.setVertexBuffer(slot, native, offset, size);
    },
    setIndexBuffer(buffer: Buffer, format: IndexFormat, offset?: number, size?: number): void {
      const native = (buffer as InternalBuffer)[GPU_BUFFER];
      pass.setIndexBuffer(native, format, offset, size);
    },
    draw(vertexCount: number, instanceCount?: number, firstVertex?: number, firstInstance?: number): void {
      pass.draw(vertexCount, instanceCount, firstVertex, firstInstance);
    },
    drawIndexed(
      indexCount: number,
      instanceCount?: number,
      firstIndex?: number,
      baseVertex?: number,
      firstInstance?: number,
    ): void {
      pass.drawIndexed(indexCount, instanceCount, firstIndex, baseVertex, firstInstance);
    },
    end(): void {
      pass.end();
    },
  };
};
