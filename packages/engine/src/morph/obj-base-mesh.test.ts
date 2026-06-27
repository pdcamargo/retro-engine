import { describe, expect, it } from 'bun:test';

import { parseObjBaseMesh } from './obj-base-mesh';
import { MeshAttribute } from '../mesh/vertex-attribute';

const QUAD = `
# a unit quad with UVs, one quad face
v 0 0 0
v 1 0 0
v 1 1 0
v 0 1 0
vt 0 0
vt 1 0
vt 1 1
vt 0 1
f 1/1 2/2 3/3 4/4
`;

describe('parseObjBaseMesh', () => {
  it('preserves vertex order and fan-triangulates a quad', () => {
    const mesh = parseObjBaseMesh(QUAD);
    expect(mesh.vertexCount).toBe(4);
    const pos = mesh.getAttribute(MeshAttribute.POSITION)!.data as Float32Array;
    expect([...pos]).toEqual([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]);
    // quad → two triangles: (0,1,2),(0,2,3)
    expect([...mesh.indices!.data]).toEqual([0, 1, 2, 0, 2, 3]);
    expect(mesh.hasAttribute(MeshAttribute.UV_0)).toBe(true);
    expect(mesh.hasAttribute(MeshAttribute.NORMAL)).toBe(true);
  });

  it('assigns one UV per position (first occurrence)', () => {
    const mesh = parseObjBaseMesh(QUAD);
    const uv = mesh.getAttribute(MeshAttribute.UV_0)!.data as Float32Array;
    expect([...uv]).toEqual([0, 0, 1, 0, 1, 1, 0, 1]);
  });

  it('handles triangle faces and v-only / v//vn tokens', () => {
    const tri = 'v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n';
    expect([...parseObjBaseMesh(tri).indices!.data]).toEqual([0, 1, 2]);
    const triN = 'v 0 0 0\nv 1 0 0\nv 0 1 0\nvn 0 0 1\nf 1//1 2//1 3//1\n';
    expect(parseObjBaseMesh(triN).vertexCount).toBe(3);
  });

  it('throws on no vertices and on out-of-range face indices', () => {
    expect(() => parseObjBaseMesh('# empty\n')).toThrow(/no vertices/);
    expect(() => parseObjBaseMesh('v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 9\n')).toThrow(/out of range/);
  });
});
