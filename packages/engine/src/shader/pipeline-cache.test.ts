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

const fail = (msg: string): never => {
  throw new Error(`pipeline-cache test renderer: ${msg}`);
};

const baseCapabilities: RendererCapabilities = {
  computeShaders: false,
  storageTextures: false,
  timestampQueries: false,
  indirectDraw: false,
  bgra8UnormStorage: false,
  baseVertex: true,
};

interface RecordingRenderer extends Renderer {
  readonly modules: ShaderModuleDescriptor[];
  readonly pipelines: RenderPipelineDescriptor[];
}

const makeRecordingRenderer = (): RecordingRenderer => {
  const modules: ShaderModuleDescriptor[] = [];
  const pipelines: RenderPipelineDescriptor[] = [];
  return {
    modules,
    pipelines,
    capabilities: baseCapabilities,
    init: () => Promise.resolve(),
    destroy: () => undefined,
    getPreferredSurfaceFormat: (): TextureFormat => 'rgba8unorm',
    createSurface: (): Surface => fail('createSurface'),
    createShaderModule: (descriptor: ShaderModuleDescriptor): ShaderModule => {
      modules.push(descriptor);
      return { destroy: () => undefined };
    },
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
    createPipelineLayout: (_descriptor: PipelineLayoutDescriptor): PipelineLayout =>
      ({ destroy: () => undefined }),
    createBindGroup: (_descriptor: BindGroupDescriptor): BindGroup => fail('createBindGroup'),
    createRenderPipeline: (descriptor: RenderPipelineDescriptor): RenderPipeline => {
      pipelines.push(descriptor);
      return { destroy: () => undefined };
    },
    createCommandEncoder: (): CommandEncoder => fail('createCommandEncoder'),
    resolveRenderTarget: (_target: RenderTarget): ResolvedRenderTarget =>
      fail('resolveRenderTarget'),
    submit: (): void => fail('submit'),
  };
};

const SHADER_A = 'fn main() {}';
const SHADER_B = 'fn other() {}';

describe('PipelineCache.compileShader', () => {
  it('compiles once for identical sources', () => {
    const renderer = makeRecordingRenderer();
    const cache = new PipelineCache(renderer, new ShaderRegistry());
    const a = cache.compileShader(new Shader(SHADER_A));
    const b = cache.compileShader(new Shader(SHADER_A));
    expect(a).toBe(b);
    expect(renderer.modules).toHaveLength(1);
    expect(cache.shaderModuleCount).toBe(1);
  });

  it('compiles separately for different sources', () => {
    const renderer = makeRecordingRenderer();
    const cache = new PipelineCache(renderer, new ShaderRegistry());
    cache.compileShader(new Shader(SHADER_A));
    cache.compileShader(new Shader(SHADER_B));
    expect(renderer.modules).toHaveLength(2);
    expect(cache.shaderModuleCount).toBe(2);
  });

  it('dedupes shaders that preprocess to identical text', () => {
    const renderer = makeRecordingRenderer();
    const registry = new ShaderRegistry();
    registry.register('test::a', 'const X = 1;');
    const cache = new PipelineCache(renderer, registry);
    // Different raw sources, identical preprocessed source.
    const a = cache.compileShader(new Shader('#import test::a\nfn main() {}'));
    const b = cache.compileShader(new Shader('const X = 1;\nfn main() {}'));
    expect(a).toBe(b);
    expect(renderer.modules).toHaveLength(1);
  });

  it('different defines produce different modules', () => {
    const renderer = makeRecordingRenderer();
    const cache = new PipelineCache(renderer, new ShaderRegistry());
    const shader = new Shader('#ifdef HDR\nconst MODE = "hdr";\n#else\nconst MODE = "sdr";\n#endif');
    cache.compileShader(shader, { HDR: true });
    cache.compileShader(shader, { HDR: false });
    expect(renderer.modules).toHaveLength(2);
  });

  it('passes the shader label through to the backend', () => {
    const renderer = makeRecordingRenderer();
    const cache = new PipelineCache(renderer, new ShaderRegistry());
    cache.compileShader(new Shader(SHADER_A, { label: 'triangle' }));
    expect(renderer.modules[0]?.label).toBe('triangle');
  });
});

describe('PipelineCache.getOrCreateRenderPipeline', () => {
  const buildDescriptor = (
    module: ShaderModule,
    layout: PipelineLayout,
    format: TextureFormat,
  ): RenderPipelineDescriptor => ({
    layout,
    vertex: { module, entryPoint: 'vs_main' },
    fragment: { module, entryPoint: 'fs_main', targets: [{ format }] },
    primitive: { topology: 'triangle-list' },
  });

  it('compiles once for identical descriptors', () => {
    const renderer = makeRecordingRenderer();
    const cache = new PipelineCache(renderer, new ShaderRegistry());
    const module = cache.compileShader(new Shader(SHADER_A));
    const layout = renderer.createPipelineLayout({ bindGroupLayouts: [] });
    const a = cache.getOrCreateRenderPipeline(buildDescriptor(module, layout, 'rgba8unorm'));
    const b = cache.getOrCreateRenderPipeline(buildDescriptor(module, layout, 'rgba8unorm'));
    expect(a).toBe(b);
    expect(renderer.pipelines).toHaveLength(1);
    expect(cache.renderPipelineCount).toBe(1);
  });

  it('compiles separately when the color-target format differs', () => {
    const renderer = makeRecordingRenderer();
    const cache = new PipelineCache(renderer, new ShaderRegistry());
    const module = cache.compileShader(new Shader(SHADER_A));
    const layout = renderer.createPipelineLayout({ bindGroupLayouts: [] });
    cache.getOrCreateRenderPipeline(buildDescriptor(module, layout, 'rgba8unorm'));
    cache.getOrCreateRenderPipeline(buildDescriptor(module, layout, 'bgra8unorm'));
    expect(renderer.pipelines).toHaveLength(2);
  });

  it('compiles separately when the entry-point differs', () => {
    const renderer = makeRecordingRenderer();
    const cache = new PipelineCache(renderer, new ShaderRegistry());
    const module = cache.compileShader(new Shader(SHADER_A));
    const layout = renderer.createPipelineLayout({ bindGroupLayouts: [] });
    const base = buildDescriptor(module, layout, 'rgba8unorm');
    cache.getOrCreateRenderPipeline(base);
    cache.getOrCreateRenderPipeline({ ...base, vertex: { module, entryPoint: 'vs_other' } });
    expect(renderer.pipelines).toHaveLength(2);
  });

  it('compiles separately when the pipeline layout differs', () => {
    const renderer = makeRecordingRenderer();
    const cache = new PipelineCache(renderer, new ShaderRegistry());
    const module = cache.compileShader(new Shader(SHADER_A));
    const layoutA = renderer.createPipelineLayout({ bindGroupLayouts: [] });
    const layoutB = renderer.createPipelineLayout({ bindGroupLayouts: [] });
    cache.getOrCreateRenderPipeline(buildDescriptor(module, layoutA, 'rgba8unorm'));
    cache.getOrCreateRenderPipeline(buildDescriptor(module, layoutB, 'rgba8unorm'));
    expect(renderer.pipelines).toHaveLength(2);
  });

  it('label-only differences do not invalidate the cache', () => {
    const renderer = makeRecordingRenderer();
    const cache = new PipelineCache(renderer, new ShaderRegistry());
    const module = cache.compileShader(new Shader(SHADER_A));
    const layout = renderer.createPipelineLayout({ bindGroupLayouts: [] });
    cache.getOrCreateRenderPipeline({
      ...buildDescriptor(module, layout, 'rgba8unorm'),
      label: 'a',
    });
    cache.getOrCreateRenderPipeline({
      ...buildDescriptor(module, layout, 'rgba8unorm'),
      label: 'b',
    });
    expect(renderer.pipelines).toHaveLength(1);
  });
});
