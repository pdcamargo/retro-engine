import { describe, expect, it } from 'bun:test';

import { asAssetIndex, makeHandle } from '@retro-engine/engine';
import type { Image as ImageType, Mesh, StandardMaterial } from '@retro-engine/engine';

import type { MappedGltfAssets } from './asset-mapping';
import { buildGltfRoot } from './build-gltf-root';
import type { GltfDocument } from './schema';

const meshH = (i: number) => makeHandle<Mesh>(asAssetIndex(i));
const matH = (i: number) => makeHandle<StandardMaterial>(asAssetIndex(i));
const imgH = (i: number) => makeHandle<ImageType>(asAssetIndex(i));

const emptyMapped: MappedGltfAssets = {
  meshes: [],
  materials: [],
  images: [],
  animationClips: [],
};

describe('buildGltfRoot — scenes and named maps', () => {
  it('assembles scenes, the default scene, and the name maps', () => {
    const document: GltfDocument = {
      asset: { version: '2.0' },
      scene: 1,
      scenes: [{ nodes: [0], name: 'A' }, { nodes: [1] }],
      nodes: [{ name: 'n0' }, { name: 'n1' }],
    };
    const gltf = buildGltfRoot(document, emptyMapped);

    expect(gltf.scenes).toHaveLength(2);
    expect(gltf.defaultScene).toBe(gltf.scenes[1]);
    expect(gltf.namedScenes.get('A')).toBe(gltf.scenes[0]);
    expect(gltf.namedNodes.get('n0')).toBe(gltf.nodes[0]);
    expect(gltf.namedNodes.get('n1')).toBe(gltf.nodes[1]);
  });

  it('leaves defaultScene undefined when the document has no scene index', () => {
    const gltf = buildGltfRoot({ asset: { version: '2.0' }, scenes: [{ nodes: [] }] }, emptyMapped);
    expect(gltf.defaultScene).toBeUndefined();
  });

  it('keeps the first node for a duplicated name and skips nameless nodes', () => {
    const document: GltfDocument = {
      asset: { version: '2.0' },
      nodes: [{ name: 'dup' }, {}, { name: 'dup' }],
    };
    const gltf = buildGltfRoot(document, emptyMapped);
    expect(gltf.namedNodes.size).toBe(1);
    expect(gltf.namedNodes.get('dup')).toBe(gltf.nodes[0]);
  });
});

describe('buildGltfRoot — node transforms', () => {
  it('passes a TRS triple through to the node Transform', () => {
    const document: GltfDocument = {
      asset: { version: '2.0' },
      nodes: [{ translation: [1, 2, 3], rotation: [0, 0, 0, 1], scale: [4, 5, 6] }],
    };
    const t = buildGltfRoot(document, emptyMapped).nodes[0]!.transform;
    expect([t.translation[0], t.translation[1], t.translation[2]]).toEqual([1, 2, 3]);
    expect([t.scale[0], t.scale[1], t.scale[2]]).toEqual([4, 5, 6]);
  });

  it('decomposes a node matrix into translation and scale', () => {
    // Column-major: uniform scale 2 on the diagonal, translation (1, 2, 3).
    const document: GltfDocument = {
      asset: { version: '2.0' },
      nodes: [{ matrix: [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 1, 2, 3, 1] }],
    };
    const t = buildGltfRoot(document, emptyMapped).nodes[0]!.transform;
    expect(t.translation[0]).toBeCloseTo(1, 5);
    expect(t.translation[1]).toBeCloseTo(2, 5);
    expect(t.translation[2]).toBeCloseTo(3, 5);
    expect(t.scale[0]).toBeCloseTo(2, 5);
    expect(t.scale[1]).toBeCloseTo(2, 5);
    expect(t.scale[2]).toBeCloseTo(2, 5);
    expect(t.rotation[3]).toBeCloseTo(1, 5); // identity quaternion w
  });
});

describe('buildGltfRoot — mapped assets', () => {
  it('carries mesh primitives, materials, and images through with names', () => {
    const document: GltfDocument = {
      asset: { version: '2.0' },
      meshes: [{ primitives: [], name: 'Cube' }],
      materials: [{ name: 'Leaves' }, {}],
    };
    const mapped: MappedGltfAssets = {
      meshes: [{ primitives: [{ mesh: meshH(0), material: matH(0) }, { mesh: meshH(1) }] }],
      materials: [matH(0), matH(1)],
      images: [imgH(0)],
      animationClips: [],
    };
    const gltf = buildGltfRoot(document, mapped);

    expect(gltf.meshes[0]!.name).toBe('Cube');
    expect(gltf.meshes[0]!.primitives).toHaveLength(2);
    expect(gltf.meshes[0]!.primitives[0]!.mesh).toEqual(meshH(0));
    expect(gltf.meshes[0]!.primitives[0]!.material).toEqual(matH(0));
    expect(gltf.meshes[0]!.primitives[1]!.material).toBeUndefined();
    expect(gltf.namedMeshes.get('Cube')).toBe(gltf.meshes[0]);

    expect(gltf.materials).toEqual([matH(0), matH(1)]);
    expect(gltf.namedMaterials.get('Leaves')).toEqual(matH(0));
    expect(gltf.namedMaterials.size).toBe(1); // the nameless material is skipped
    expect(gltf.images).toEqual([imgH(0)]);
  });
});
