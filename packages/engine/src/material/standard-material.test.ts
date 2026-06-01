import { describe, expect, it } from 'bun:test';

import type {
  BindGroup,
  BindGroupDescriptor,
  BindGroupLayout,
  BindGroupLayoutDescriptor,
  Buffer,
  BufferDescriptor,
  RendererCapabilities,
  Sampler,
  Texture,
  TextureFormat,
  TextureView,
} from '@retro-engine/renderer-core';

import { Images } from '../image/images';
import { RenderImages } from '../image/image-plugin';
import type { RenderImage } from '../image/render-image';

import { schemaToBindGroupLayout, prepareBindGroup } from './prepare-bind-group';
import { StandardMaterial } from './standard-material';

describe('StandardMaterial fields', () => {
  it('defaults normalScale to 1 and doubleSided to false', () => {
    const m = new StandardMaterial();
    expect(m.normalScale).toBe(1);
    expect(m.doubleSided()).toBe(false);
  });

  it('takes normalScale and doubleSided from the constructor', () => {
    const m = new StandardMaterial({ normalScale: 2.5, doubleSided: true });
    expect(m.normalScale).toBe(2.5);
    expect(m.doubleSided()).toBe(true);
  });
});

// Minimal renderer that records the uniform buffer and its writes — enough to
// assert the packed std140 layout of the binding-0 material uniform.
const fail = (msg: string): never => {
  throw new Error(`standard-material test renderer: ${msg}`);
};

const capabilities: RendererCapabilities = {
  computeShaders: false,
  storageTextures: false,
  timestampQueries: false,
  indirectDraw: false,
  bgra8UnormStorage: false,
  baseVertex: true,
};

const makeRecordingRenderer = () => {
  const buffers: BufferDescriptor[] = [];
  const writes: { offset: number; data: ArrayBuffer }[] = [];
  const renderer = {
    capabilities,
    init: () => Promise.resolve(),
    destroy: () => undefined,
    getPreferredSurfaceFormat: (): TextureFormat => 'rgba8unorm',
    createSurface: () => fail('createSurface'),
    createShaderModule: () => fail('createShaderModule'),
    createBuffer: (descriptor: BufferDescriptor): Buffer => {
      buffers.push(descriptor);
      return { size: descriptor.size, usage: descriptor.usage, destroy: () => undefined };
    },
    createTexture: () => fail('createTexture'),
    createSampler: () => fail('createSampler'),
    writeBuffer: (_buffer: Buffer, offset: number, data: BufferSource): void => {
      const slice = data instanceof ArrayBuffer ? data : data.buffer.slice(0);
      writes.push({ offset, data: slice as ArrayBuffer });
    },
    writeTexture: () => fail('writeTexture'),
    createBindGroupLayout: (_d: BindGroupLayoutDescriptor): BindGroupLayout => ({
      destroy: () => undefined,
    }),
    createPipelineLayout: () => fail('createPipelineLayout'),
    createBindGroup: (_d: BindGroupDescriptor): BindGroup => ({ destroy: () => undefined }),
    createRenderPipeline: () => fail('createRenderPipeline'),
    createCommandEncoder: () => fail('createCommandEncoder'),
    resolveRenderTarget: () => fail('resolveRenderTarget'),
    submit: () => fail('submit'),
  } as unknown as import('@retro-engine/renderer-core').Renderer;
  return { renderer, buffers, writes };
};

const stubTextureView: TextureView = { destroy: () => undefined };
const stubSampler: Sampler = { destroy: () => undefined };
const stubTexture: Texture = {
  width: 1,
  height: 1,
  depthOrArrayLayers: 1,
  format: 'rgba8unorm',
  mipLevelCount: 1,
  sampleCount: 1,
  usage: 0,
  createView: () => stubTextureView,
  destroy: () => undefined,
};
const stubRenderImage: RenderImage = {
  texture: stubTexture,
  view: stubTextureView,
  sampler: stubSampler,
};

const seedRenderImages = (images: Images): RenderImages => {
  const ri = new RenderImages();
  ri.set(images.WHITE, stubRenderImage);
  ri.set(images.NORMAL_FLAT, stubRenderImage);
  return ri;
};

describe('StandardMaterial uniform packing', () => {
  it('packs normalScale into a 64-byte slot at f32 index 12 (byte offset 48)', () => {
    const { renderer, buffers, writes } = makeRecordingRenderer();
    const images = new Images();
    const renderImages = seedRenderImages(images);
    const layout = schemaToBindGroupLayout(renderer, StandardMaterial.bindGroup, 'standard');
    const material = new StandardMaterial({ normalScale: 2.5 });
    const scratch = new ArrayBuffer(64);
    prepareBindGroup(
      renderer,
      StandardMaterial.bindGroup,
      layout,
      material,
      undefined,
      scratch,
      images,
      renderImages,
      'standard',
    );

    // std140: two vec4f (32) + four leading f32 + normalScale at index 12,
    // rounded up to a 64-byte slot.
    expect(buffers[0]!.size).toBe(64);
    expect(writes).toHaveLength(1);
    const data = new Float32Array(writes[0]!.data);
    expect(data[8]).toBe(0); // metallic (default)
    expect(data[9]).toBe(0.5); // roughness (default)
    expect(data[10]).toBe(1); // occlusionStrength (default)
    expect(data[11]).toBe(0.5); // alphaCutoff (default)
    expect(data[12]).toBeCloseTo(2.5, 5); // normalScale
  });
});
