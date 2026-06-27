import { describe, expect, it } from 'bun:test';

import { parseMakeHumanRig } from './makehuman-rig';
import { parseMakeHumanWeights } from './makehuman-weights';

const RIG = JSON.stringify({
  license: 'CC0',
  Root: { head: { default_position: [0, 0, 0] }, tail: { default_position: [0, 1, 0] }, parent: '' },
  spine: { head: { default_position: [0, 1, 0] }, tail: { default_position: [0, 2, 0] }, parent: 'Root' },
  head: { head: { default_position: [0, 2, 0] }, tail: { default_position: [0, 3, 0] }, parent: 'spine' },
});

describe('parseMakeHumanRig', () => {
  it('parses bones topologically with a name→index map', () => {
    const rig = parseMakeHumanRig(RIG);
    expect(rig.bones.map((b) => b.name)).toEqual(['Root', 'spine', 'head']);
    expect(rig.bones[1]!.parent).toBe('Root');
    expect([...rig.bones[1]!.head]).toEqual([0, 1, 0]);
    expect(rig.indexOf.get('head')).toBe(2);
    expect(rig.bones[0]!.parent).toBeNull(); // '' → root
  });

  it('throws on an unknown parent', () => {
    const bad = JSON.stringify({ a: { head: { default_position: [0, 0, 0] }, tail: { default_position: [0, 1, 0] }, parent: 'ghost' } });
    expect(() => parseMakeHumanRig(bad)).toThrow(/unknown parent/);
  });
});

describe('parseMakeHumanWeights', () => {
  it('inverts bone→verts into per-vertex top-4 normalized influences', () => {
    const rig = parseMakeHumanRig(RIG); // Root=0, spine=1, head=2
    const w = parseMakeHumanWeights(
      JSON.stringify({ weights: { Root: [[0, 1.0]], spine: [[1, 0.5], [0, 0.25]] } }),
      rig,
      3,
    );
    // vertex 0: Root 1.0 + spine 0.25 → normalized 0.8 / 0.2
    expect([w.joints[0], w.joints[1]]).toEqual([0, 1]);
    expect(w.weights[0]).toBeCloseTo(0.8, 5);
    expect(w.weights[1]).toBeCloseTo(0.2, 5);
    // vertex 1: spine only → joint 1, weight 1
    expect(w.joints[4]).toBe(1);
    expect(w.weights[4]).toBeCloseTo(1, 5);
    // vertex 2: unweighted → pinned to joint 0
    expect(w.joints[8]).toBe(0);
    expect(w.weights[8]).toBeCloseTo(1, 5);
  });
});
