import { describe, expect, it } from 'bun:test';

import { color, vec3 } from '@retro-engine/math';

import { EDITOR_GIZMO_MASK } from './gizmo-layers';
import { Gizmos } from './gizmos';

const white = color(1, 1, 1, 1);

describe('Gizmos', () => {
  it('pushes one segment per line with endpoints and color', () => {
    const g = new Gizmos();
    g.line(vec3.create(0, 0, 0), vec3.create(1, 2, 3), white);
    expect(g.count).toBe(1);
    expect(Array.from(g.positions.subarray(0, 6))).toEqual([0, 0, 0, 1, 2, 3]);
    expect(g.colors[0]).toBe(1);
    expect(g.depthFlags[0]).toBe(1); // depth-tested by default
  });

  it('records a per-endpoint gradient', () => {
    const g = new Gizmos();
    g.lineGradient(vec3.create(0, 0, 0), vec3.create(1, 0, 0), color(1, 0, 0, 1), color(0, 0, 1, 1));
    expect(Array.from(g.colors.subarray(0, 8))).toEqual([1, 0, 0, 1, 0, 0, 1, 1]);
  });

  it('honors per-call layer and depth overrides', () => {
    const g = new Gizmos();
    g.line(vec3.create(0, 0, 0), vec3.create(0, 1, 0), white, { layer: EDITOR_GIZMO_MASK, depthTest: false });
    expect(g.layerMask[0]).toBe(EDITOR_GIZMO_MASK);
    expect(g.depthFlags[0]).toBe(0);
  });

  it('decomposes composite shapes into the expected segment counts', () => {
    const g = new Gizmos();
    g.circle(vec3.create(0, 0, 0), vec3.create(0, 1, 0), 1, white, 16);
    expect(g.count).toBe(16);
    g.clear();
    g.cuboid(vec3.create(0, 0, 0), vec3.create(1, 1, 1), white);
    expect(g.count).toBe(12);
    g.clear();
    g.sphere(vec3.create(0, 0, 0), 1, white, 20);
    expect(g.count).toBe(60); // three great circles
    g.clear();
    g.arrow(vec3.create(0, 0, 0), vec3.create(0, 1, 0), white);
    expect(g.count).toBe(5); // shaft + 4 head spokes
  });

  it('clear() resets the frame to empty', () => {
    const g = new Gizmos();
    g.line(vec3.create(0, 0, 0), vec3.create(1, 0, 0), white);
    g.clear();
    expect(g.count).toBe(0);
  });

  it('grows its backing arrays past the initial capacity', () => {
    const g = new Gizmos();
    for (let i = 0; i < 600; i++) g.line(vec3.create(i, 0, 0), vec3.create(i, 1, 0), white);
    expect(g.count).toBe(600);
    // Last segment survived the growth intact.
    const p = 599 * 6;
    expect(Array.from(g.positions.subarray(p, p + 6))).toEqual([599, 0, 0, 599, 1, 0]);
  });
});
