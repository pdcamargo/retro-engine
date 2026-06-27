import { describe, expect, it } from 'bun:test';

import { MorphTargets } from './morph-targets';
import { MorphWeights } from './morph-weights';

const targets = (names: string[], defaults?: number[]): MorphTargets =>
  new MorphTargets(
    names.map((name) => ({
      name,
      positionDeltas: new Float32Array(6),
      normalDeltas: new Float32Array(6),
    })),
    2,
    defaults,
  );

describe('MorphTargets', () => {
  it('exposes names and count in index order', () => {
    const t = targets(['a', 'b']);
    expect(t.count).toBe(2);
    expect(t.names).toEqual(['a', 'b']);
  });

  it('defaults weights to zero when none supplied or length mismatches', () => {
    expect([...targets(['a', 'b']).defaultWeights]).toEqual([0, 0]);
    expect([...targets(['a', 'b'], [1]).defaultWeights]).toEqual([0, 0]);
    expect([...targets(['a', 'b'], [0.3, 0.7]).defaultWeights]).toEqual([0.3, 0.7]);
  });
});

describe('MorphWeights', () => {
  it('seeds from a mesh target set without aliasing it', () => {
    const t = targets(['smile', 'frown'], [0.2, 0]);
    const w = MorphWeights.fromTargets(t);
    expect(w.names).toEqual(['smile', 'frown']);
    expect(w.weights).toEqual([0.2, 0]);
    w.weights[0] = 1;
    expect(t.defaultWeights[0]).toBe(0.2);
  });

  it('addresses weights by target name', () => {
    const w = new MorphWeights(['smile', 'frown'], [0, 0]);
    expect(w.indexOf('frown')).toBe(1);
    expect(w.indexOf('missing')).toBe(-1);
    w.set('smile', 0.5);
    expect(w.get('smile')).toBe(0.5);
    w.set('missing', 1);
    expect(w.weights).toEqual([0.5, 0]);
    expect(w.get('missing')).toBeUndefined();
  });
});
