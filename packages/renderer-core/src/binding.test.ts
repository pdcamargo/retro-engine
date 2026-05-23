import { describe, expect, it } from 'bun:test';

import { ShaderStage } from './binding';
import type {
  BindGroupDescriptor,
  BindGroupLayout,
  BindGroupLayoutDescriptor,
  Buffer,
  PipelineLayoutDescriptor,
  Sampler,
  ShaderStageFlags,
  TextureView,
} from './index';

describe('ShaderStage', () => {
  it('exposes the expected stage bits', () => {
    expect(ShaderStage.VERTEX).toBe(0x1);
    expect(ShaderStage.FRAGMENT).toBe(0x2);
    expect(ShaderStage.COMPUTE).toBe(0x4);
  });

  it('combines via bitwise OR', () => {
    const both: ShaderStageFlags = ShaderStage.VERTEX | ShaderStage.FRAGMENT;
    expect(both & ShaderStage.VERTEX).not.toBe(0);
    expect(both & ShaderStage.FRAGMENT).not.toBe(0);
    expect(both & ShaderStage.COMPUTE).toBe(0);
  });
});

describe('Binding descriptor structural shapes', () => {
  it('BindGroupLayoutDescriptor accepts the documented entry kinds', () => {
    const desc: BindGroupLayoutDescriptor = {
      label: 'camera-layout',
      entries: [
        { binding: 0, visibility: ShaderStage.VERTEX, buffer: { type: 'uniform' } },
        {
          binding: 1,
          visibility: ShaderStage.FRAGMENT,
          texture: { sampleType: 'float', viewDimension: '2d' },
        },
        { binding: 2, visibility: ShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
        {
          binding: 3,
          visibility: ShaderStage.COMPUTE,
          storageTexture: { format: 'rgba8unorm', access: 'write-only' },
        },
      ],
    };
    expect(desc.entries).toHaveLength(4);
  });

  it('PipelineLayoutDescriptor accepts an ordered list of BindGroupLayouts', () => {
    // We can't instantiate a BindGroupLayout without a backend, but we can
    // assert the descriptor's structural shape.
    const desc: PipelineLayoutDescriptor = {
      label: 'standard',
      bindGroupLayouts: [],
    };
    expect(desc.bindGroupLayouts).toHaveLength(0);
  });

  it('BindGroupDescriptor accepts the three binding-resource forms (type-level)', () => {
    // No live backend means we can't construct concrete HAL handles; the
    // test below checks the descriptor compiles against each `BindingResource`
    // variant — buffer binding, sampler, texture view.
    const layout = null as unknown as BindGroupLayout;
    const buffer = null as unknown as Buffer;
    const sampler = null as unknown as Sampler;
    const view = null as unknown as TextureView;
    const desc: BindGroupDescriptor = {
      layout,
      entries: [
        { binding: 0, resource: { buffer, offset: 0, size: 64 } },
        { binding: 1, resource: sampler },
        { binding: 2, resource: view },
      ],
    };
    expect(desc.entries).toHaveLength(3);
  });
});
