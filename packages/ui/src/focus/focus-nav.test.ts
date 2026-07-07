import { describe, expect, it } from 'bun:test';

import type { Entity } from '@retro-engine/ecs';

import { type FocusNode, spatialNavigate, tabNavigate } from './focus-nav';

const e = (n: number): Entity => n as unknown as Entity;
const box = (id: number, x: number, y: number, w = 40, h = 20): FocusNode => ({
  entity: e(id),
  x,
  y,
  width: w,
  height: h,
});

describe('tabNavigate', () => {
  const nodes = [box(1, 0, 0), box(2, 0, 30), box(3, 0, 60)];

  it('advances to the next node, wrapping at the end', () => {
    expect(tabNavigate(nodes, e(1), false)).toBe(e(2));
    expect(tabNavigate(nodes, e(3), false)).toBe(e(1)); // wrap
  });

  it('goes to the previous node in reverse, wrapping at the start', () => {
    expect(tabNavigate(nodes, e(2), true)).toBe(e(1));
    expect(tabNavigate(nodes, e(1), true)).toBe(e(3)); // wrap
  });

  it('enters at the first node (last, reversed) with no / unknown focus', () => {
    expect(tabNavigate(nodes, null, false)).toBe(e(1));
    expect(tabNavigate(nodes, null, true)).toBe(e(3));
    expect(tabNavigate(nodes, e(99), false)).toBe(e(1)); // unknown current
  });

  it('returns null when nothing is focusable', () => {
    expect(tabNavigate([], e(1), false)).toBeNull();
  });
});

describe('spatialNavigate', () => {
  // A 2×2 grid: 1 top-left, 2 top-right, 3 bottom-left, 4 bottom-right.
  const grid = [box(1, 0, 0), box(2, 100, 0), box(3, 0, 100), box(4, 100, 100)];

  it('moves to the aligned neighbour in each direction', () => {
    expect(spatialNavigate(grid, e(1), 'right')).toBe(e(2));
    expect(spatialNavigate(grid, e(1), 'down')).toBe(e(3));
    expect(spatialNavigate(grid, e(4), 'left')).toBe(e(3));
    expect(spatialNavigate(grid, e(4), 'up')).toBe(e(2));
  });

  it('returns null when nothing lies in the direction (focus should stay)', () => {
    expect(spatialNavigate(grid, e(1), 'left')).toBeNull();
    expect(spatialNavigate(grid, e(1), 'up')).toBeNull();
  });

  it('prefers the aligned candidate over a closer but skewed one', () => {
    // Right of `from`(0,0): an aligned far node vs. a near but vertically skewed one.
    const nodes = [box(1, 0, 0), box(2, 200, 0), box(3, 60, 300)];
    expect(spatialNavigate(nodes, e(1), 'right')).toBe(e(2));
  });

  it('enters at the first node with no current focus', () => {
    expect(spatialNavigate(grid, null, 'right')).toBe(e(1));
  });

  it('returns null for an empty set', () => {
    expect(spatialNavigate([], e(1), 'right')).toBeNull();
  });
});
