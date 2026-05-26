import { describe, expect, it } from 'bun:test';

import type { Entity } from '@retro-engine/ecs';

import { RetainedSlotMap, type Slot } from './retained-slot-map';

const e = (n: number): Entity => n as Entity;

/** Assert no two live runs overlap and every run stays inside capacity. */
const assertDisjoint = (map: RetainedSlotMap): void => {
  const occupied = new Set<number>();
  for (const [, slot] of map.entries()) {
    for (let i = slot.first; i < slot.first + slot.len; i++) {
      expect(occupied.has(i)).toBe(false);
      expect(i).toBeLessThan(map.capacityInstances());
      occupied.add(i);
    }
  }
  expect(occupied.size).toBe(map.liveInstances);
};

describe('RetainedSlotMap', () => {
  it('bump-allocates contiguous runs and tracks capacity', () => {
    const map = new RetainedSlotMap();
    expect(map.alloc(e(1), 1)).toEqual({ first: 0, len: 1 } as Slot);
    expect(map.alloc(e(2), 1)).toEqual({ first: 1, len: 1 } as Slot);
    expect(map.alloc(e(3), 9)).toEqual({ first: 2, len: 9 } as Slot);
    expect(map.capacityInstances()).toBe(11);
    expect(map.liveInstances).toBe(11);
    expect(map.freeInstances).toBe(0);
    assertDisjoint(map);
  });

  it('returns the same slot when re-alloced at the same length', () => {
    const map = new RetainedSlotMap();
    const first = map.alloc(e(1), 1);
    const again = map.alloc(e(1), 1);
    expect(again).toBe(first);
    expect(map.capacityInstances()).toBe(1);
  });

  it('recycles a freed run for a same-length alloc instead of growing', () => {
    const map = new RetainedSlotMap();
    map.alloc(e(1), 1);
    map.alloc(e(2), 1);
    map.free(e(1));
    expect(map.freeInstances).toBe(1);
    const reused = map.alloc(e(3), 1);
    expect(reused.first).toBe(0); // the hole e(1) left, not a fresh slot at 2
    expect(map.capacityInstances()).toBe(2);
    expect(map.freeInstances).toBe(0);
    assertDisjoint(map);
  });

  it('keeps free runs bucketed by length — a len-1 hole does not satisfy a len-9 alloc', () => {
    const map = new RetainedSlotMap();
    map.alloc(e(1), 1);
    map.free(e(1));
    const big = map.alloc(e(2), 9);
    expect(big.first).toBe(1); // bumped past the high-water, did not reuse the len-1 hole
    expect(map.capacityInstances()).toBe(10);
    assertDisjoint(map);
  });

  it('re-lengths by freeing the old run then allocating the new one', () => {
    const map = new RetainedSlotMap();
    map.alloc(e(1), 1);
    map.alloc(e(2), 1);
    const grown = map.alloc(e(1), 9); // 1 -> 9
    expect(grown.len).toBe(9);
    expect(map.get(e(1))).toBe(grown);
    expect(map.freeInstances).toBe(1); // the old len-1 run is now free
    assertDisjoint(map);
  });

  it('compacts holes and reports every moved run', () => {
    const map = new RetainedSlotMap();
    map.alloc(e(1), 1); // first 0
    map.alloc(e(2), 2); // first 1..2
    map.alloc(e(3), 1); // first 3
    map.free(e(2)); // hole at 1..2
    expect(map.fragmentation()).toBeCloseTo(2 / 4);

    const moves: Array<[number, number, number, number]> = [];
    map.compact((entity, oldFirst, newFirst, len) => moves.push([entity, oldFirst, newFirst, len]));

    // e(1) stays at 0; e(3) slides from 3 -> 1.
    expect(map.get(e(1))!.first).toBe(0);
    expect(map.get(e(3))!.first).toBe(1);
    expect(moves).toEqual([[3, 3, 1, 1]]);
    expect(map.capacityInstances()).toBe(2);
    expect(map.freeInstances).toBe(0);
    assertDisjoint(map);
  });

  it('compact is a no-op with no holes', () => {
    const map = new RetainedSlotMap();
    map.alloc(e(1), 1);
    map.alloc(e(2), 1);
    let moves = 0;
    map.compact(() => moves++);
    expect(moves).toBe(0);
  });

  it('bumps generation on every structural change', () => {
    const map = new RetainedSlotMap();
    const g0 = map.generation;
    map.alloc(e(1), 1);
    const g1 = map.generation;
    expect(g1).toBeGreaterThan(g0);
    map.free(e(1));
    expect(map.generation).toBeGreaterThan(g1);
  });

  it('survives randomized alloc/free churn without overlaps', () => {
    const map = new RetainedSlotMap();
    const live = new Set<number>();
    let rng = 123456789;
    const next = (): number => {
      rng = (rng * 1103515245 + 12345) & 0x7fffffff;
      return rng;
    };
    for (let step = 0; step < 5000; step++) {
      const id = (next() % 200) + 1;
      if (live.has(id)) {
        map.free(e(id));
        live.delete(id);
      } else {
        const len = next() % 5 === 0 ? 9 : 1;
        map.alloc(e(id), len);
        live.add(id);
      }
      if (next() % 500 === 0) map.compact(() => {});
    }
    assertDisjoint(map);
    expect(map.size).toBe(live.size);
  });
});
