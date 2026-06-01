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
  RenderPipeline,
  RenderPipelineDescriptor,
  RenderTarget,
  Renderer,
  RendererCapabilities,
  ResolvedRenderTarget,
  Sampler,
  SamplerDescriptor,
  ShaderModule,
  ShaderModuleDescriptor,
  Surface,
  Texture,
  TextureDescriptor,
  TextureFormat,
  TextureView,
} from '@retro-engine/renderer-core';
import { ShaderStage } from '@retro-engine/renderer-core';

import { vec4 } from '@retro-engine/math';

import type { Handle } from '@retro-engine/assets';

import { Image } from '../image/image';
import { RenderImages } from '../image/image-plugin';
import { Images } from '../image/images';
import type { RenderImage } from '../image/render-image';

import {
  MaterialSchema,
  visibilityToFlags,
  uniformFieldByteSize,
  uniformFieldAlignment,
} from './bind-group-schema';
import {
  schemaToBindGroupLayout,
  uniformFieldOffsets,
  uniformSlotByteSize,
  prepareBindGroup,
} from './prepare-bind-group';

const fail = (msg: string): never => {
  throw new Error(`schema test renderer: ${msg}`);
};

const capabilities: RendererCapabilities = {
  computeShaders: false,
  storageTextures: false,
  timestampQueries: false,
  indirectDraw: false,
  bgra8UnormStorage: false,
  baseVertex: true,
};

interface RecordingRenderer extends Renderer {
  readonly bindGroupLayouts: BindGroupLayoutDescriptor[];
  readonly bindGroups: BindGroupDescriptor[];
  readonly buffers: BufferDescriptor[];
  readonly writes: { buffer: Buffer; offset: number; data: ArrayBuffer }[];
}

const makeRecordingRenderer = (): RecordingRenderer => {
  const bindGroupLayouts: BindGroupLayoutDescriptor[] = [];
  const bindGroups: BindGroupDescriptor[] = [];
  const buffers: BufferDescriptor[] = [];
  const writes: { buffer: Buffer; offset: number; data: ArrayBuffer }[] = [];

  const r: RecordingRenderer = {
    bindGroupLayouts,
    bindGroups,
    buffers,
    writes,
    capabilities,
    init: () => Promise.resolve(),
    destroy: () => undefined,
    getPreferredSurfaceFormat: (): TextureFormat => 'rgba8unorm',
    createSurface: (): Surface => fail('createSurface'),
    createShaderModule: (_d: ShaderModuleDescriptor): ShaderModule => fail('createShaderModule'),
    createBuffer: (descriptor: BufferDescriptor): Buffer => {
      buffers.push(descriptor);
      return { size: descriptor.size, usage: descriptor.usage, destroy: () => undefined };
    },
    createTexture: (_d: TextureDescriptor): Texture => fail('createTexture'),
    createSampler: (_d?: SamplerDescriptor): Sampler => fail('createSampler'),
    writeBuffer: (buffer: Buffer, offset: number, data: BufferSource): void => {
      const slice = data instanceof ArrayBuffer ? data : data.buffer.slice(0);
      writes.push({ buffer, offset, data: slice as ArrayBuffer });
    },
    writeTexture: (
      _d: ImageCopyTexture,
      _data: BufferSource,
      _layout: ImageDataLayout,
      _size: Extent3D,
    ): void => fail('writeTexture'),
    createBindGroupLayout: (descriptor: BindGroupLayoutDescriptor): BindGroupLayout => {
      bindGroupLayouts.push(descriptor);
      return { destroy: () => undefined };
    },
    createPipelineLayout: (_d: PipelineLayoutDescriptor): PipelineLayout => fail('createPipelineLayout'),
    createBindGroup: (descriptor: BindGroupDescriptor): BindGroup => {
      bindGroups.push(descriptor);
      return { destroy: () => undefined };
    },
    createRenderPipeline: (_d: RenderPipelineDescriptor): RenderPipeline => fail('createRenderPipeline'),
    createCommandEncoder: (): CommandEncoder => fail('createCommandEncoder'),
    resolveRenderTarget: (_t: RenderTarget): ResolvedRenderTarget => fail('resolveRenderTarget'),
    submit: (): void => fail('submit'),
  };
  return r;
};

describe('visibilityToFlags', () => {
  it('maps alias to bitfield', () => {
    expect(visibilityToFlags('vertex')).toBe(ShaderStage.VERTEX);
    expect(visibilityToFlags('fragment')).toBe(ShaderStage.FRAGMENT);
    expect(visibilityToFlags('both')).toBe(ShaderStage.VERTEX | ShaderStage.FRAGMENT);
  });
});

describe('uniformFieldByteSize / uniformFieldAlignment', () => {
  it('returns natural sizes and std140 alignment', () => {
    expect(uniformFieldByteSize('f32')).toBe(4);
    expect(uniformFieldByteSize('vec2f')).toBe(8);
    expect(uniformFieldByteSize('vec3f')).toBe(12);
    expect(uniformFieldByteSize('vec4f')).toBe(16);
    expect(uniformFieldAlignment('vec3f')).toBe(16); // padded
    expect(uniformFieldAlignment('vec2f')).toBe(8);
    expect(uniformFieldAlignment('f32')).toBe(4);
  });
});

describe('uniformSlotByteSize / uniformFieldOffsets', () => {
  it('respects std140 alignment for mixed packs', () => {
    // vec3f (12 bytes, align 16) then f32 (4 bytes, align 4)
    // offsets: 0, 16. Total 20, rounded to 32.
    const fields = [
      { fieldKey: 'a' as const, pack: 'vec3f' as const },
      { fieldKey: 'b' as const, pack: 'f32' as const },
    ];
    expect(uniformFieldOffsets(fields)).toEqual([0, 12]); // vec3f offset 0, f32 packs in trailing slot of vec3f at offset 12 (alignment 4 fits)
    // Wait: vec3f is 12 bytes, then f32 at the next align-4 boundary (12) so it does fit at offset 12.
    expect(uniformSlotByteSize(fields)).toBe(16); // 16 bytes total after alignUp(16, 16)
  });

  it('produces a multiple-of-16 total even for single-f32 slot', () => {
    expect(uniformSlotByteSize([{ fieldKey: 'a', pack: 'f32' }])).toBe(16);
  });

  it('packs two vec4f back-to-back', () => {
    const fields = [
      { fieldKey: 'a' as const, pack: 'vec4f' as const },
      { fieldKey: 'b' as const, pack: 'vec4f' as const },
    ];
    expect(uniformFieldOffsets(fields)).toEqual([0, 16]);
    expect(uniformSlotByteSize(fields)).toBe(32);
  });
});

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
  ri.set(images.BLACK, stubRenderImage);
  ri.set(images.NORMAL_FLAT, stubRenderImage);
  return ri;
};

class FakeMaterial {
  color: { x: number; y: number; z: number; w: number } = { x: 1, y: 0.5, z: 0.25, w: 1 };
  metallic = 0.4;
  baseColorTexture: TextureView | undefined;

  static readonly bindGroup = MaterialSchema(FakeMaterial, [
    {
      kind: 'uniform',
      binding: 0,
      visibility: 'fragment',
      fields: [
        { fieldKey: 'color', pack: 'vec4f' },
        { fieldKey: 'metallic', pack: 'f32' },
      ],
    },
    {
      kind: 'texture',
      binding: 1,
      visibility: 'fragment',
      imageMode: 'view',
      fieldKey: 'baseColorTexture',
    },
  ]);
}

class HandleMaterial {
  color: { x: number; y: number; z: number; w: number } = { x: 1, y: 1, z: 1, w: 1 };
  baseColorTexture: Handle<Image> | undefined;
  normalMapTexture: Handle<Image> | undefined;

  static readonly bindGroup = MaterialSchema(HandleMaterial, [
    {
      kind: 'uniform',
      binding: 0,
      visibility: 'fragment',
      fields: [{ fieldKey: 'color', pack: 'vec4f' }],
    },
    {
      kind: 'texture',
      binding: 1,
      visibility: 'fragment',
      imageMode: 'handle',
      fieldKey: 'baseColorTexture',
      fallback: 'white',
    },
    {
      kind: 'sampler',
      binding: 2,
      visibility: 'fragment',
      imageMode: 'handle',
      fieldKey: 'baseColorTexture',
      fallback: 'white',
    },
    {
      kind: 'texture',
      binding: 3,
      visibility: 'fragment',
      imageMode: 'handle',
      fieldKey: 'normalMapTexture',
      fallback: 'normalFlat',
    },
  ]);
}

describe('schemaToBindGroupLayout', () => {
  it('lays out a uniform + texture material', () => {
    const renderer = makeRecordingRenderer();
    const layout = schemaToBindGroupLayout(renderer, FakeMaterial.bindGroup, 'fake');
    expect(layout).toBeDefined();
    expect(renderer.bindGroupLayouts).toHaveLength(1);
    const desc = renderer.bindGroupLayouts[0]!;
    expect(desc.label).toBe('fake');
    expect(desc.entries).toHaveLength(2);
    expect(desc.entries[0]?.binding).toBe(0);
    expect(desc.entries[0]?.buffer?.type).toBe('uniform');
    expect(desc.entries[1]?.binding).toBe(1);
    expect(desc.entries[1]?.texture).toBeDefined();
  });
});

describe('prepareBindGroup (view-mode escape hatch)', () => {
  it('packs uniforms and binds the texture (view mode reads the raw field)', () => {
    const renderer = makeRecordingRenderer();
    const images = new Images();
    const renderImages = seedRenderImages(images);
    const layout = schemaToBindGroupLayout(renderer, FakeMaterial.bindGroup, 'fake');
    const localStubView: TextureView = { destroy: () => undefined };
    const material = new FakeMaterial();
    material.baseColorTexture = localStubView;
    const scratch = new ArrayBuffer(64);
    const prepared = prepareBindGroup(
      renderer,
      FakeMaterial.bindGroup,
      layout,
      material,
      undefined,
      scratch,
      images,
      renderImages,
      'fake',
    );
    expect(prepared.bindGroup).toBeDefined();
    expect(prepared.uniformBuffer).toBeDefined();
    expect(prepared.uniformBuffer?.usage).toBeGreaterThan(0);
    // One write to the uniform buffer.
    expect(renderer.writes).toHaveLength(1);
    const write = renderer.writes[0]!;
    const data = new Float32Array(write.data);
    expect(data[0]).toBe(1); // color.x
    expect(data[1]).toBe(0.5); // color.y
    expect(data[2]).toBe(0.25); // color.z
    expect(data[3]).toBe(1); // color.w
    expect(data[4]).toBeCloseTo(0.4, 5); // metallic
    // Bind group has two entries.
    expect(renderer.bindGroups).toHaveLength(1);
    const bgDesc = renderer.bindGroups[0]!;
    expect(bgDesc.entries).toHaveLength(2);
    expect(bgDesc.entries[1]?.resource).toBe(localStubView);
  });

  it('throws when a view-mode texture field is undefined', () => {
    const renderer = makeRecordingRenderer();
    const images = new Images();
    const renderImages = seedRenderImages(images);
    const layout = schemaToBindGroupLayout(renderer, FakeMaterial.bindGroup, 'fake');
    const material = new FakeMaterial(); // baseColorTexture is undefined
    const scratch = new ArrayBuffer(64);
    expect(() =>
      prepareBindGroup(
        renderer,
        FakeMaterial.bindGroup,
        layout,
        material,
        undefined,
        scratch,
        images,
        renderImages,
        'fake',
      ),
    ).toThrow(/baseColorTexture/);
  });

  it('reuses the uniform buffer across prepares of the same material', () => {
    const renderer = makeRecordingRenderer();
    const images = new Images();
    const renderImages = seedRenderImages(images);
    const layout = schemaToBindGroupLayout(renderer, FakeMaterial.bindGroup, 'fake');
    const localStubView: TextureView = { destroy: () => undefined };
    const material = new FakeMaterial();
    material.baseColorTexture = localStubView;
    const scratch = new ArrayBuffer(64);
    const first = prepareBindGroup(
      renderer,
      FakeMaterial.bindGroup,
      layout,
      material,
      undefined,
      scratch,
      images,
      renderImages,
    );
    material.metallic = 0.9;
    const second = prepareBindGroup(
      renderer,
      FakeMaterial.bindGroup,
      layout,
      material,
      first,
      scratch,
      images,
      renderImages,
    );
    expect(second.uniformBuffer).toBe(first.uniformBuffer); // same buffer, re-uploaded
    expect(renderer.writes).toHaveLength(2);
    expect(new Float32Array(renderer.writes[1]!.data)[4]).toBeCloseTo(0.9, 5);
  });
});

describe('prepareBindGroup (handle mode)', () => {
  it('resolves an explicit ImageHandle through RenderImages', () => {
    const renderer = makeRecordingRenderer();
    const images = new Images();
    const renderImages = seedRenderImages(images);
    // A custom image with its own stub render-image entry.
    const customHandle = images.add(Image.solid(vec4.create(1, 0, 0, 1)));
    const customView: TextureView = { destroy: () => undefined };
    const customSampler: Sampler = { destroy: () => undefined };
    renderImages.set(customHandle, {
      texture: stubTexture,
      view: customView,
      sampler: customSampler,
    });
    const layout = schemaToBindGroupLayout(renderer, HandleMaterial.bindGroup, 'handle');
    const material = new HandleMaterial();
    material.baseColorTexture = customHandle;
    // normalMapTexture is intentionally undefined → falls back to NORMAL_FLAT.
    const scratch = new ArrayBuffer(64);
    prepareBindGroup(
      renderer,
      HandleMaterial.bindGroup,
      layout,
      material,
      undefined,
      scratch,
      images,
      renderImages,
      'handle',
    );
    const bg = renderer.bindGroups[0]!;
    // bindings 0 (uniform), 1 (baseColorTexture view), 2 (baseColorTexture sampler), 3 (normalMap view fallback)
    expect(bg.entries[1]?.resource).toBe(customView);
    expect(bg.entries[2]?.resource).toBe(customSampler);
    expect(bg.entries[3]?.resource).toBe(stubRenderImage.view);
  });

  it('falls back to Images.WHITE when a handle-mode field is undefined', () => {
    const renderer = makeRecordingRenderer();
    const images = new Images();
    const whiteView: TextureView = { destroy: () => undefined };
    const whiteSampler: Sampler = { destroy: () => undefined };
    const renderImages = new RenderImages();
    renderImages.set(images.WHITE, {
      texture: stubTexture,
      view: whiteView,
      sampler: whiteSampler,
    });
    renderImages.set(images.NORMAL_FLAT, stubRenderImage);
    const layout = schemaToBindGroupLayout(renderer, HandleMaterial.bindGroup, 'handle');
    const material = new HandleMaterial(); // every field undefined
    const scratch = new ArrayBuffer(64);
    prepareBindGroup(
      renderer,
      HandleMaterial.bindGroup,
      layout,
      material,
      undefined,
      scratch,
      images,
      renderImages,
      'handle',
    );
    const bg = renderer.bindGroups[0]!;
    expect(bg.entries[1]?.resource).toBe(whiteView);
    expect(bg.entries[2]?.resource).toBe(whiteSampler);
  });

  it("falls back to Images.NORMAL_FLAT for a normalMap entry's undefined field", () => {
    const renderer = makeRecordingRenderer();
    const images = new Images();
    const normalView: TextureView = { destroy: () => undefined };
    const renderImages = new RenderImages();
    renderImages.set(images.WHITE, stubRenderImage);
    renderImages.set(images.NORMAL_FLAT, {
      texture: stubTexture,
      view: normalView,
      sampler: stubSampler,
    });
    const layout = schemaToBindGroupLayout(renderer, HandleMaterial.bindGroup, 'handle');
    const material = new HandleMaterial();
    const scratch = new ArrayBuffer(64);
    prepareBindGroup(
      renderer,
      HandleMaterial.bindGroup,
      layout,
      material,
      undefined,
      scratch,
      images,
      renderImages,
      'handle',
    );
    const bg = renderer.bindGroups[0]!;
    // binding 3 is the normalMapTexture entry; it picks up NORMAL_FLAT.view.
    expect(bg.entries[3]?.resource).toBe(normalView);
  });

  it("throws when an Image's dimension is cube or 3d (no Phase 7.5 consumer)", () => {
    const renderer = makeRecordingRenderer();
    const images = new Images();
    const cubeHandle = images.add(
      Image.fromBytes({
        data: new Uint8Array(24),
        format: 'rgba8unorm',
        width: 1,
        height: 1,
        depthOrArrayLayers: 6,
        dimension: 'cube',
      }),
    );
    const renderImages = seedRenderImages(images);
    renderImages.set(cubeHandle, stubRenderImage);
    const layout = schemaToBindGroupLayout(renderer, HandleMaterial.bindGroup, 'handle');
    const material = new HandleMaterial();
    material.baseColorTexture = cubeHandle;
    const scratch = new ArrayBuffer(64);
    expect(() =>
      prepareBindGroup(
        renderer,
        HandleMaterial.bindGroup,
        layout,
        material,
        undefined,
        scratch,
        images,
        renderImages,
        'handle',
      ),
    ).toThrow(/dimension 'cube'/);
  });

  it('throws with a guiding message when RenderImages has no entry for the resolved handle', () => {
    const renderer = makeRecordingRenderer();
    const images = new Images();
    const renderImages = new RenderImages(); // intentionally empty — no WHITE entry
    const layout = schemaToBindGroupLayout(renderer, HandleMaterial.bindGroup, 'handle');
    const material = new HandleMaterial();
    const scratch = new ArrayBuffer(64);
    expect(() =>
      prepareBindGroup(
        renderer,
        HandleMaterial.bindGroup,
        layout,
        material,
        undefined,
        scratch,
        images,
        renderImages,
        'handle',
      ),
    ).toThrow(/ImagePlugin/);
  });
});
