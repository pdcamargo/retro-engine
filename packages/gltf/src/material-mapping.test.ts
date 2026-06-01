import { Assets, type Image } from '@retro-engine/engine';
import { describe, expect, it } from 'bun:test';

import { createImageResolver } from './image-mapping';
import { fakeLoadContext, stubDecoder } from './mapping-test-support';
import { mapMaterialToStandardMaterial } from './material-mapping';
import type { GltfDocument, GltfMaterial } from './schema';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const texturedDoc = (material: GltfMaterial): GltfDocument => ({
  asset: { version: '2.0' },
  materials: [material],
  textures: [
    { source: 0 },
    { source: 1 },
    { source: 2 },
    { source: 3 },
    { source: 4 },
  ],
  images: [
    { uri: 'base.png' },
    { uri: 'normal.png' },
    { uri: 'mr.png' },
    { uri: 'occ.png' },
    { uri: 'emis.png' },
  ],
});

const files = {
  'base.png': PNG,
  'normal.png': PNG,
  'mr.png': PNG,
  'occ.png': PNG,
  'emis.png': PNG,
};

describe('mapMaterialToStandardMaterial', () => {
  it('maps the full pbrMetallicRoughness set incl. normalScale / doubleSided', async () => {
    const material: GltfMaterial = {
      pbrMetallicRoughness: {
        baseColorFactor: [0.2, 0.4, 0.6, 0.8],
        baseColorTexture: { index: 0 },
        metallicFactor: 0.25,
        roughnessFactor: 0.75,
        metallicRoughnessTexture: { index: 2 },
      },
      normalTexture: { index: 1, scale: 0.5 },
      occlusionTexture: { index: 3, strength: 0.3 },
      emissiveFactor: [1, 0.5, 0],
      emissiveTexture: { index: 4 },
      alphaMode: 'MASK',
      alphaCutoff: 0.2,
      doubleSided: true,
    };
    const document = texturedDoc(material);
    const images = new Assets<Image>();
    const { ctx } = fakeLoadContext(files);
    const resolver = createImageResolver(document, [], ctx, images, stubDecoder);

    const mat = await mapMaterialToStandardMaterial(document, material, resolver);

    [0.2, 0.4, 0.6, 0.8].forEach((c, i) => expect(mat.baseColor[i]).toBeCloseTo(c));
    expect(mat.metallic).toBeCloseTo(0.25);
    expect(mat.roughness).toBeCloseTo(0.75);
    expect(mat.normalScale).toBeCloseTo(0.5);
    expect(mat.occlusionStrength).toBeCloseTo(0.3);
    expect(Array.from(mat.emissive)).toEqual([1, 0.5, 0, 1]);
    expect(mat.alphaMode()).toEqual({ kind: 'mask', cutoff: 0.2 });
    expect(mat.alphaCutoff).toBeCloseTo(0.2);
    expect(mat.doubleSided()).toBe(true);

    // Per-slot color space.
    expect(images.get(mat.baseColorTexture!)!.colorSpace).toBe('srgb');
    expect(images.get(mat.emissiveTexture!)!.colorSpace).toBe('srgb');
    expect(images.get(mat.normalMapTexture!)!.colorSpace).toBe('linear');
    expect(images.get(mat.metallicRoughnessTexture!)!.colorSpace).toBe('linear');
    expect(images.get(mat.occlusionTexture!)!.colorSpace).toBe('linear');
  });

  it('applies glTF factor defaults (metallic = roughness = 1, opaque, single-sided)', async () => {
    const material: GltfMaterial = {};
    const document: GltfDocument = { asset: { version: '2.0' }, materials: [material] };
    const images = new Assets<Image>();
    const { ctx } = fakeLoadContext();
    const resolver = createImageResolver(document, [], ctx, images, stubDecoder);

    const mat = await mapMaterialToStandardMaterial(document, material, resolver);

    expect(Array.from(mat.baseColor)).toEqual([1, 1, 1, 1]);
    expect(mat.metallic).toBe(1);
    expect(mat.roughness).toBe(1);
    expect(mat.alphaMode()).toBe('opaque');
    expect(mat.doubleSided()).toBe(false);
    expect(mat.baseColorTexture).toBeUndefined();
    expect(images.size).toBe(0);
  });
});
