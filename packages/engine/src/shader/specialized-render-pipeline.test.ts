import { describe, expect, it } from 'bun:test';

import type {
  BindGroup,
  BindGroupDescriptor,
  BindGroupLayout,
  BindGroupLayoutDescriptor,
  Buffer,
  BufferDescriptor,
  CommandEncoder,
  Extent3D,
  ImageCopyTexture,
  ImageDataLayout,
  PipelineLayout,
  PipelineLayoutDescriptor,
  Renderer,
  RendererCapabilities,
  RenderPipeline,
  RenderPipelineDescriptor,
  RenderTarget,
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

import { PipelineCache } from './pipeline-cache';
import { Shader } from './shader';
import { ShaderRegistry } from './shader-registry';
import { SpecializedRenderPipelines } from './specialized-render-pipeline';

const fail = (msg: string): never => {
  throw new Error(`specialized-render-pipeline test renderer: ${msg}`);
};

const baseCapabilities: RendererCapabilities = {
  computeShaders: false,
  storageTextures: false,
  timestampQueries: false,
  indirectDraw: false,
  bgra8UnormStorage: false,
};

interface RecordingRenderer extends Renderer {
  readonly pipelineCalls: RenderPipelineDescriptor[];
}

const makeRecordingRenderer = (): RecordingRenderer => {
  const pipelineCalls: RenderPipelineDescriptor[] = [];
  return {
    pipelineCalls,
    capabilities: baseCapabilities,
    init: () => Promise.resolve(),
    destroy: () => undefined,
    getPreferredSurfaceFormat: (): TextureFormat => 'rgba8unorm',
    createSurface: (): Surface => fail('createSurface'),
    createShaderModule: (_descriptor: ShaderModuleDescriptor): ShaderModule => ({
      destroy: () => undefined,
    }),
    createBuffer: (_descriptor: BufferDescriptor): Buffer => fail('createBuffer'),
    createTexture: (_descriptor: TextureDescriptor): Texture => fail('createTexture'),
    createSampler: (_descriptor?: SamplerDescriptor): Sampler => fail('createSampler'),
    writeBuffer: (_buffer: Buffer, _offset: number, _data: BufferSource): void =>
      fail('writeBuffer'),
    writeTexture: (
      _destination: ImageCopyTexture,
      _data: BufferSource,
      _dataLayout: ImageDataLayout,
      _size: Extent3D,
    ): void => fail('writeTexture'),
    createBindGroupLayout: (_descriptor: BindGroupLayoutDescriptor): BindGroupLayout =>
      fail('createBindGroupLayout'),
    createPipelineLayout: (_descriptor: PipelineLayoutDescriptor): PipelineLayout => ({
      destroy: () => undefined,
    }),
    createBindGroup: (_descriptor: BindGroupDescriptor): BindGroup => fail('createBindGroup'),
    createRenderPipeline: (descriptor: RenderPipelineDescriptor): RenderPipeline => {
      pipelineCalls.push(descriptor);
      return { destroy: () => undefined };
    },
    createCommandEncoder: (): CommandEncoder => fail('createCommandEncoder'),
    resolveRenderTarget: (_target: RenderTarget): ResolvedRenderTarget =>
      fail('resolveRenderTarget'),
    submit: (): void => fail('submit'),
  };
};

interface DemoKey {
  format: TextureFormat;
  msaa: 1 | 2 | 4 | 8;
}

const setup = () => {
  const renderer = makeRecordingRenderer();
  const cache = new PipelineCache(renderer, new ShaderRegistry());
  const module = cache.compileShader(new Shader('fn main() {}'));
  const layout = renderer.createPipelineLayout({ bindGroupLayouts: [] });
  // Vary entry-point names with msaa so every distinct key produces a distinct
  // descriptor — without this, the PipelineCache would correctly collapse
  // keys whose only difference is msaa (Phase 4 has no HAL knob for sample
  // count yet). Real consumers will encode msaa into a primitive/multisample
  // descriptor field once Phase 12 adds it.
  const specialize = (key: DemoKey): RenderPipelineDescriptor => ({
    label: `demo-${key.format}-${key.msaa}`,
    layout,
    vertex: { module, entryPoint: `vs_${key.msaa}x` },
    fragment: { module, entryPoint: `fs_${key.msaa}x`, targets: [{ format: key.format }] },
    primitive: { topology: 'triangle-list' },
  });
  return { renderer, cache, specialize };
};

describe('SpecializedRenderPipelines', () => {
  it('builds one pipeline per distinct key', () => {
    const { renderer, cache, specialize } = setup();
    const specs = new SpecializedRenderPipelines<DemoKey>(cache, specialize);
    const a = specs.get({ format: 'rgba8unorm', msaa: 1 });
    const b = specs.get({ format: 'rgba8unorm', msaa: 1 });
    expect(a).toBe(b);
    expect(specs.keyCount).toBe(1);
    expect(renderer.pipelineCalls).toHaveLength(1);
  });

  it('builds new pipelines for keys that differ in any field', () => {
    const { renderer, cache, specialize } = setup();
    const specs = new SpecializedRenderPipelines<DemoKey>(cache, specialize);
    specs.get({ format: 'rgba8unorm', msaa: 1 });
    specs.get({ format: 'rgba8unorm', msaa: 4 });
    specs.get({ format: 'bgra8unorm', msaa: 1 });
    expect(specs.keyCount).toBe(3);
    expect(renderer.pipelineCalls).toHaveLength(3);
  });

  it('shares the underlying pipeline when distinct keys produce identical descriptors', () => {
    const { renderer, cache } = setup();
    const module = cache.compileShader(new Shader('fn main() {}'));
    const ignoredField = (_key: { _scratch: number }): RenderPipelineDescriptor => ({
      layout: 'auto',
      vertex: { module, entryPoint: 'vs' },
      fragment: { module, entryPoint: 'fs', targets: [{ format: 'rgba8unorm' }] },
      primitive: { topology: 'triangle-list' },
    });
    const specs = new SpecializedRenderPipelines<{ _scratch: number }>(cache, ignoredField);
    const a = specs.get({ _scratch: 1 });
    const b = specs.get({ _scratch: 2 });
    expect(a).toBe(b); // shared via the PipelineCache descriptor hash
    expect(specs.keyCount).toBe(2); // two key entries, both pointing at the same pipeline
    expect(renderer.pipelineCalls).toHaveLength(1);
  });

  it('honors a custom keyToString', () => {
    const { renderer, cache, specialize } = setup();
    const specs = new SpecializedRenderPipelines<DemoKey>(
      cache,
      specialize,
      (key) => `${key.format}|${key.msaa}`,
    );
    const a = specs.get({ format: 'rgba8unorm', msaa: 1 });
    const b = specs.get({ msaa: 1, format: 'rgba8unorm' });
    // Default JSON.stringify would key these differently if property order
    // wasn't stable; the custom keyToString collapses them deterministically.
    expect(a).toBe(b);
    expect(renderer.pipelineCalls).toHaveLength(1);
  });
});
