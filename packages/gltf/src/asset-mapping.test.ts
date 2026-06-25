import {
  AnimationClips,
  Assets,
  type Image,
  type Mesh,
  type StandardMaterial,
} from '@retro-engine/engine';
import { describe, expect, it } from 'bun:test';

import { mapGltfAssets } from './asset-mapping';
import { fakeLoadContext, rawBytes, stubDecoder } from './mapping-test-support';
import type { GltfDocument } from './schema';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * A two-material model: one mesh with two primitives, each its own material.
 * Both materials' base color points at the same image (shared → deduped); one
 * material adds a normal map (a second, linear image) and is double-sided.
 */
const multiMaterialDoc = (): { document: GltfDocument; buffers: Uint8Array[] } => {
  const position = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const indices = new Uint16Array([0, 1, 2]);
  const document: GltfDocument = {
    asset: { version: '2.0' },
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: position.byteLength },
      { buffer: 1, byteOffset: 0, byteLength: indices.byteLength },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' },
    ],
    meshes: [
      {
        primitives: [
          { attributes: { POSITION: 0 }, indices: 1, material: 0 },
          { attributes: { POSITION: 0 }, indices: 1, material: 1 },
        ],
      },
    ],
    materials: [
      {
        pbrMetallicRoughness: { baseColorTexture: { index: 0 } },
        normalTexture: { index: 1, scale: 0.5 },
        doubleSided: true,
      },
      { pbrMetallicRoughness: { baseColorTexture: { index: 0 } } },
    ],
    textures: [{ source: 0 }, { source: 1 }],
    images: [{ uri: 'shared.png' }, { uri: 'normal.png' }],
  };
  return { document, buffers: [rawBytes(position), rawBytes(indices)] };
};

describe('mapGltfAssets', () => {
  it('maps a multi-material model with dedup and field carry-through', async () => {
    const { document, buffers } = multiMaterialDoc();
    const stores = {
      meshes: new Assets<Mesh>(),
      materials: new Assets<StandardMaterial>(),
      images: new Assets<Image>(),
      animationClips: new AnimationClips(),
    };
    const { ctx, labels } = fakeLoadContext({ 'shared.png': PNG, 'normal.png': PNG });

    const mapped = await mapGltfAssets(document, buffers, ctx, stores, stubDecoder);

    // One mesh, two primitives, each wired to its material.
    expect(mapped.meshes).toHaveLength(1);
    expect(mapped.meshes[0]!.primitives).toHaveLength(2);
    expect(mapped.meshes[0]!.primitives[0]!.material!.index).toBe(mapped.materials[0]!.index);
    expect(mapped.meshes[0]!.primitives[1]!.material!.index).toBe(mapped.materials[1]!.index);

    // Shared base-color image deduped to one handle; the normal map is the second.
    expect(mapped.materials).toHaveLength(2);
    expect(mapped.images).toHaveLength(2);
    const mat0 = stores.materials.get(mapped.materials[0]!)!;
    const mat1 = stores.materials.get(mapped.materials[1]!)!;
    expect(mat0.baseColorTexture!.index).toBe(mat1.baseColorTexture!.index);

    // Double-sided + normal-scale carried through.
    expect(mat0.doubleSided()).toBe(true);
    expect(mat0.normalScale).toBeCloseTo(0.5);

    // Labels: sub-assets registered with diagnostic names.
    expect(labels).toContain('Material0');
    expect(labels).toContain('Mesh0/Primitive1');
    expect(labels.filter((l) => l.startsWith('Image'))).toHaveLength(2);
  });
});
