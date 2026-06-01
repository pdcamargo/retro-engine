// prepareBindGroup hot path (Renderer Phase 7.5 / ADR-0030):
//
// Every material instance with a dirty event re-walks its schema once per
// frame. The Phase 7.5 walker handles two new shapes for each texture and
// sampler entry — `imageMode: 'handle'` (resolve through `RenderImages`,
// fall back to a named default) and `imageMode: 'view'` / `'sampler'` (raw
// escape hatch, unchanged from Phase 7). This bench exercises the handle
// path with all fields set (no fallback) and all fields undefined (every
// binding falls back).
//
// See docs/adr/ADR-0017 (bench schema) and docs/adr/ADR-0030 (image asset).

import { bench, summary } from 'mitata';

import type { Handle } from '@retro-engine/assets';
import type { Sampler, Texture, TextureView } from '@retro-engine/renderer-core';

import { Image, Images, RenderImages, MaterialSchema } from '../src';
import type { RenderImage } from '../src';
import {
  prepareBindGroup,
  schemaToBindGroupLayout,
} from '../src/material';

import { makeRenderingBenchRenderer } from './helpers';

class BenchMaterial {
  baseColor: { x: number; y: number; z: number; w: number } = { x: 1, y: 1, z: 1, w: 1 };
  emissive: { x: number; y: number; z: number; w: number } = { x: 0, y: 0, z: 0, w: 0 };
  metallic = 0;
  roughness = 0.5;
  baseColorTexture: Handle<Image> | undefined;
  metallicRoughnessTexture: Handle<Image> | undefined;
  normalMapTexture: Handle<Image> | undefined;
  emissiveTexture: Handle<Image> | undefined;
  occlusionTexture: Handle<Image> | undefined;

  static readonly bindGroup = MaterialSchema(BenchMaterial, [
    {
      kind: 'uniform',
      binding: 0,
      visibility: 'fragment',
      fields: [
        { fieldKey: 'baseColor', pack: 'vec4f' },
        { fieldKey: 'emissive', pack: 'vec4f' },
        { fieldKey: 'metallic', pack: 'f32' },
        { fieldKey: 'roughness', pack: 'f32' },
      ],
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
      fieldKey: 'metallicRoughnessTexture',
      fallback: 'white',
    },
    {
      kind: 'texture',
      binding: 4,
      visibility: 'fragment',
      imageMode: 'handle',
      fieldKey: 'normalMapTexture',
      fallback: 'normalFlat',
    },
    {
      kind: 'texture',
      binding: 5,
      visibility: 'fragment',
      imageMode: 'handle',
      fieldKey: 'emissiveTexture',
      fallback: 'white',
    },
    {
      kind: 'texture',
      binding: 6,
      visibility: 'fragment',
      imageMode: 'handle',
      fieldKey: 'occlusionTexture',
      fallback: 'white',
    },
  ]);
}

const stubView: TextureView = { destroy: () => undefined };
const stubSampler: Sampler = { destroy: () => undefined };
const stubTexture: Texture = {
  width: 1,
  height: 1,
  depthOrArrayLayers: 1,
  format: 'rgba8unorm',
  mipLevelCount: 1,
  sampleCount: 1,
  usage: 0,
  createView: () => stubView,
  destroy: () => undefined,
};
const stubRenderImage: RenderImage = { texture: stubTexture, view: stubView, sampler: stubSampler };

const seed = (): {
  renderer: ReturnType<typeof makeRenderingBenchRenderer>;
  images: Images;
  renderImages: RenderImages;
  layout: ReturnType<typeof schemaToBindGroupLayout>;
} => {
  const renderer = makeRenderingBenchRenderer();
  const images = new Images();
  const renderImages = new RenderImages();
  renderImages.set(images.WHITE, stubRenderImage);
  renderImages.set(images.BLACK, stubRenderImage);
  renderImages.set(images.NORMAL_FLAT, stubRenderImage);
  const layout = schemaToBindGroupLayout(renderer, BenchMaterial.bindGroup, 'bench');
  return { renderer, images, renderImages, layout };
};

summary(() => {
  bench('prepareBindGroup: handle mode, all fields set (no fallback path)', () => {
    const { renderer, images, renderImages, layout } = seed();
    const customHandle = images.add(images.get(images.WHITE)!); // re-uses WHITE shape
    renderImages.set(customHandle, stubRenderImage);
    const material = new BenchMaterial();
    material.baseColorTexture = customHandle;
    material.metallicRoughnessTexture = customHandle;
    material.normalMapTexture = customHandle;
    material.emissiveTexture = customHandle;
    material.occlusionTexture = customHandle;
    const scratch = new ArrayBuffer(128);
    prepareBindGroup(
      renderer,
      BenchMaterial.bindGroup,
      layout,
      material,
      undefined,
      scratch,
      images,
      renderImages,
      'bench-all-set',
    );
  });

  bench('prepareBindGroup: handle mode, all fields undefined (every binding falls back)', () => {
    const { renderer, images, renderImages, layout } = seed();
    const material = new BenchMaterial(); // every texture field undefined
    const scratch = new ArrayBuffer(128);
    prepareBindGroup(
      renderer,
      BenchMaterial.bindGroup,
      layout,
      material,
      undefined,
      scratch,
      images,
      renderImages,
      'bench-all-fallback',
    );
  });
});
