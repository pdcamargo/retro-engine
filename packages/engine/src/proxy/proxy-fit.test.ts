import { describe, expect, it } from 'bun:test';

import { fitProxy } from './proxy-fit';
import { parseMhclo } from './proxy-fitting';

// A base with 3 triangle corners (verts 0,1,2) plus two scale-reference verts (3,4).
const base = (): Float32Array =>
  Float32Array.from([
    0, 0, 0, // 0
    2, 0, 0, // 1
    0, 2, 0, // 2
    -1, 0, 0, // 3 (x ref a)
    1, 0, 0, // 4 (x ref b)
  ]);

describe('parseMhclo', () => {
  it('parses header, scale, and triangle + exact vertex bindings', () => {
    const text = [
      'name Shirt',
      'obj_file shirt.obj',
      'x_scale 3 4 2',
      'y_scale 3 4 2',
      'z_scale 3 4 2',
      'verts',
      '0 1 2 0.5 0.25 0.25 0.1 0.2 0.3',
      '1',
    ].join('\n');
    const f = parseMhclo(text);
    expect(f.name).toBe('Shirt');
    expect(f.objFile).toBe('shirt.obj');
    expect(f.count).toBe(2);
    expect([...f.triIndices]).toEqual([0, 1, 2, 1, 1, 1]); // exact bind → triple of same index
    expect([...f.baryWeights]).toEqual([0.5, 0.25, 0.25, 1, 0, 0]);
    expect(f.scale).toEqual({ x: { v1: 3, v2: 4, den: 2 }, y: { v1: 3, v2: 4, den: 2 }, z: { v1: 3, v2: 4, den: 2 } });
  });

  it('throws on a malformed binding line', () => {
    expect(() => parseMhclo('verts\n0 1 2 0.5 0.5')).toThrow(/expected 1 or 9/);
    expect(() => parseMhclo('verts\n0 1 2 x 0 0 0 0 0')).toThrow(/non-finite/);
  });
});

describe('fitProxy', () => {
  it('places a proxy vertex at the barycentric point plus scaled offset', () => {
    // No scale block → unit scale. bary at corner 0, offset (0,0,1).
    const f = parseMhclo('verts\n0 1 2 1 0 0 0 0 1');
    const p = fitProxy(base(), f);
    expect([...p]).toEqual([0, 0, 1]); // base[0]=(0,0,0) + offset z 1
  });

  it('follows the base when a bound triangle vertex morphs', () => {
    const f = parseMhclo('verts\n0 1 2 0 1 0 0 0 0'); // pinned to corner 1
    const b = base();
    expect([...fitProxy(b, f)]).toEqual([2, 0, 0]); // base[1]
    b[3] = 9; // move vertex 1's x (index 1*3) to 9
    expect([...fitProxy(b, f)]).toEqual([9, 0, 0]); // proxy follows
  });

  it('scales the offset by the body proportion (x_scale)', () => {
    // x_scale uses verts 3 (x=-1) and 4 (x=1) → span 2; den 2 → sx=1 at neutral.
    const f = parseMhclo('x_scale 3 4 2\ny_scale 3 4 2\nz_scale 3 4 2\nverts\n0 1 2 1 0 0 1 0 0');
    const b = base();
    expect(fitProxy(b, f)[0]).toBeCloseTo(1, 5); // sx=1 → offset x applied as-is
    // widen the body along x: move vert 4 from x=1 to x=3 → span 4 → sx=2
    b[4 * 3] = 3;
    expect(fitProxy(b, f)[0]).toBeCloseTo(2, 5); // offset x doubled
  });
});
