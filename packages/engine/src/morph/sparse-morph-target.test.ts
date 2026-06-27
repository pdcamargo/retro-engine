import { describe, expect, it } from 'bun:test';

import { SparseMorphTarget, parseSparseMorphTarget } from './sparse-morph-target';

describe('parseSparseMorphTarget', () => {
  it('parses MakeHuman .target lines, including leading-dot and negative floats', () => {
    const text = '161 0 -.011 0\n197 .026 0 -.5\n200 1 2 3\n';
    const t = parseSparseMorphTarget(text, 'nose-base-down');
    expect(t.name).toBe('nose-base-down');
    expect([...t.indices]).toEqual([161, 197, 200]);
    const expected = [0, -0.011, 0, 0.026, 0, -0.5, 1, 2, 3];
    // Float32 storage, so compare with tolerance rather than exact equality.
    expected.forEach((v, i) => expect(t.deltas[i]!).toBeCloseTo(v, 5));
    expect(t.count).toBe(3);
    expect(t.maxIndex).toBe(200);
  });

  it('skips blank lines and # comments', () => {
    const text = '# header\n\n5 1 0 0\n   \n7 0 1 0\n';
    const t = parseSparseMorphTarget(text);
    expect([...t.indices]).toEqual([5, 7]);
  });

  it('throws on a malformed line', () => {
    expect(() => parseSparseMorphTarget('5 1 0')).toThrow(/expected 4/);
    expect(() => parseSparseMorphTarget('5.5 1 0 0')).toThrow(/non-integer/);
    expect(() => parseSparseMorphTarget('-3 1 0 0')).toThrow(/non-integer\/negative/);
    expect(() => parseSparseMorphTarget('5 x 0 0')).toThrow(/non-finite/);
  });

  it('returns an empty target for empty / comment-only input', () => {
    const t = parseSparseMorphTarget('# only a comment\n\n');
    expect(t.count).toBe(0);
    expect(t.maxIndex).toBe(-1);
  });
});

describe('SparseMorphTarget', () => {
  it('reports whether it fits a base vertex count', () => {
    const t = new SparseMorphTarget('t', Uint32Array.from([0, 5, 9]), new Float32Array(9));
    expect(t.fitsBase(10)).toBe(true);
    expect(t.fitsBase(9)).toBe(false);
  });

  it('expands to a dense per-vertex delta array', () => {
    const t = new SparseMorphTarget('t', Uint32Array.from([1, 3]), Float32Array.from([1, 2, 3, 4, 5, 6]));
    const dense = t.toDense(4);
    expect([...dense]).toEqual([0, 0, 0, 1, 2, 3, 0, 0, 0, 4, 5, 6]);
  });

  it('throws when expanding an out-of-range target', () => {
    const t = new SparseMorphTarget('t', Uint32Array.from([5]), Float32Array.from([1, 1, 1]));
    expect(() => t.toDense(3)).toThrow(/exceeds base vertex count/);
  });
});
