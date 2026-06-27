import { describe, expect, it } from 'bun:test';

import { bakeMorphedMesh } from './morph-bake';
import { Mesh } from '../mesh/mesh';
import { MeshAttribute } from '../mesh/vertex-attribute';
import { u32Indices } from '../mesh/indices';
import { SparseMorphTarget } from './sparse-morph-target';

/** A 4-vertex quad base mesh (two triangles) with UVs. */
const baseQuad = (): Mesh => {
  const m = new Mesh({ label: 'base' });
  m.insertAttribute(MeshAttribute.POSITION, Float32Array.from([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]));
  m.insertAttribute(MeshAttribute.UV_0, Float32Array.from([0, 0, 1, 0, 1, 1, 0, 1]));
  m.setIndices(u32Indices(Uint32Array.from([0, 1, 2, 0, 2, 3])));
  m.computeSmoothNormals();
  return m;
};

describe('bakeMorphedMesh', () => {
  it('bakes composed positions into a fresh static mesh with copied UV/indices + normals', () => {
    const base = baseQuad();
    const basePositions = new Float32Array(base.getAttribute(MeshAttribute.POSITION)!.data as Float32Array);
    const target = new SparseMorphTarget('lift', Uint32Array.from([2]), Float32Array.from([0, 0, 5]));

    const baked = bakeMorphedMesh(base, basePositions, [{ target, weight: 1 }], 'baked');

    expect(baked).not.toBe(base);
    const pos = baked.getAttribute(MeshAttribute.POSITION)!.data as Float32Array;
    // vertex 2 lifted by (0,0,5); others unchanged.
    expect([...pos]).toEqual([0, 0, 0, 1, 0, 0, 1, 1, 5, 0, 1, 0]);
    expect(baked.hasAttribute(MeshAttribute.UV_0)).toBe(true);
    expect(baked.hasAttribute(MeshAttribute.NORMAL)).toBe(true);
    expect([...baked.indices!.data]).toEqual([0, 1, 2, 0, 2, 3]);
  });

  it('does not alias the base positions (bake from pristine, base untouched)', () => {
    const base = baseQuad();
    const basePositions = new Float32Array(base.getAttribute(MeshAttribute.POSITION)!.data as Float32Array);
    const target = new SparseMorphTarget('lift', Uint32Array.from([0]), Float32Array.from([9, 9, 9]));
    bakeMorphedMesh(base, basePositions, [{ target, weight: 1 }]);
    // base + basePositions are unchanged by the bake.
    expect([...(base.getAttribute(MeshAttribute.POSITION)!.data as Float32Array)].slice(0, 3)).toEqual([0, 0, 0]);
    expect([...basePositions].slice(0, 3)).toEqual([0, 0, 0]);
  });
});
