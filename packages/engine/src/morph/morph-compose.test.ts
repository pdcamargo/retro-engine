import { describe, expect, it } from 'bun:test';

import { composeMorphedPositions } from './morph-compose';
import { SparseMorphTarget } from './sparse-morph-target';

const base = (): Float32Array => Float32Array.from([0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3]); // 4 verts

describe('composeMorphedPositions', () => {
  it('adds a single weighted target onto the base', () => {
    const t = new SparseMorphTarget('a', Uint32Array.from([1]), Float32Array.from([10, 0, 0]));
    const out = composeMorphedPositions(base(), [{ target: t, weight: 0.5 }]);
    expect([...out]).toEqual([0, 0, 0, 6, 1, 1, 2, 2, 2, 3, 3, 3]);
  });

  it('sums multiple targets and skips zero-weight ones', () => {
    const a = new SparseMorphTarget('a', Uint32Array.from([0]), Float32Array.from([1, 0, 0]));
    const b = new SparseMorphTarget('b', Uint32Array.from([0, 3]), Float32Array.from([0, 2, 0, 0, 0, 9]));
    const z = new SparseMorphTarget('z', Uint32Array.from([0]), Float32Array.from([99, 99, 99]));
    const out = composeMorphedPositions(base(), [
      { target: a, weight: 1 },
      { target: b, weight: 1 },
      { target: z, weight: 0 },
    ]);
    expect([...out]).toEqual([1, 2, 0, 1, 1, 1, 2, 2, 2, 3, 3, 12]);
  });

  it('skips an out-of-range index instead of corrupting neighbours', () => {
    const t = new SparseMorphTarget('a', Uint32Array.from([0, 99]), Float32Array.from([5, 0, 0, 9, 9, 9]));
    const out = composeMorphedPositions(base(), [{ target: t, weight: 1 }]);
    expect([...out]).toEqual([5, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3]);
  });

  it('can compose in place', () => {
    const buf = base();
    const t = new SparseMorphTarget('a', Uint32Array.from([2]), Float32Array.from([0, 0, 1]));
    const out = composeMorphedPositions(buf, [{ target: t, weight: 2 }], buf);
    expect(out).toBe(buf);
    expect([...out]).toEqual([0, 0, 0, 1, 1, 1, 2, 2, 4, 3, 3, 3]);
  });
});
