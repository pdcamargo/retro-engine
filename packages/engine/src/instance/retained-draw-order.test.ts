import { describe, expect, it } from 'bun:test';

import type { Entity } from '@retro-engine/ecs';
import type { Buffer, Renderer } from '@retro-engine/renderer-core';

import { GrowableInstanceStore } from './growable-instance-store';
import { SortedSlotIndex } from './retained-draw-order';
import type { Slot } from './retained-slot-map';

const e = (n: number): Entity => n as Entity;
const STRIDE = 8; // 2 floats per instance

interface Write {
  offset: number;
  bytes: number;
}

const fakeRenderer = (): { renderer: Renderer; writes: Write[] } => {
  const writes: Write[] = [];
  const renderer = {
    createBuffer: () => ({ destroy() {} }) as unknown as Buffer,
    writeBuffer: (_b: Buffer, offset: number, data: BufferSource) => {
      writes.push({ offset, bytes: (data as ArrayBufferView).byteLength });
    },
  } as unknown as Renderer;
  return { renderer, writes };
};

/** Sprite-shaped key: opaque-first, back-to-front, same-image runs contiguous. */
interface Key {
  bucketKey: number;
  worldZ: number;
  image: number;
}
const compare = (a: Key, b: Key): number => {
  if (a.bucketKey !== b.bucketKey) return a.bucketKey - b.bucketKey;
  if (a.worldZ !== b.worldZ) return b.worldZ - a.worldZ;
  return a.image - b.image;
};
const sameBatch = (a: Key, b: Key): boolean => a.image === b.image && a.bucketKey === b.bucketKey;

const makeIndex = (): SortedSlotIndex<Key> => new SortedSlotIndex(STRIDE, 'ordered', compare, sameBatch);

const slot = (first: number, len = 1): Slot => ({ first, len }) as Slot;

/** A source slot buffer where each instance's first float is a recognizable sentinel. */
const makeSource = (sentinels: Record<number, number>): GrowableInstanceStore => {
  const src = new GrowableInstanceStore(STRIDE, 'src');
  src.ensureScratch(64);
  for (const [first, value] of Object.entries(sentinels)) {
    src.scratchF32[src.floatOffsetOf(Number(first))] = value;
  }
  return src;
};

const orderedSentinel = (idx: SortedSlotIndex<Key>, pos: number): number =>
  idx.ordered.scratchF32[idx.ordered.floatOffsetOf(pos)]!;

describe('SortedSlotIndex', () => {
  it('packs members back-to-front and emits one batch for a same-image run', () => {
    const { renderer } = fakeRenderer();
    const src = makeSource({ 0: 10, 1: 20, 2: 30 });
    const idx = makeIndex();
    idx.addMember(e(1), slot(0), { bucketKey: 0, worldZ: 5, image: 1 });
    idx.addMember(e(2), slot(1), { bucketKey: 0, worldZ: 3, image: 1 });
    idx.addMember(e(3), slot(2), { bucketKey: 0, worldZ: 9, image: 1 });
    idx.prepare(src, renderer);

    // Sorted -worldZ: e3(9), e1(5), e2(3) → ordered positions 0,1,2.
    expect(orderedSentinel(idx, 0)).toBe(30);
    expect(orderedSentinel(idx, 1)).toBe(10);
    expect(orderedSentinel(idx, 2)).toBe(20);
    expect(idx.batches).toHaveLength(1);
    expect(idx.batches[0]).toMatchObject({ firstInstance: 0, count: 3 });
    expect(idx.batches[0]!.key.worldZ).toBe(9); // back-most drives the batch key
  });

  it('copies only the changed member in place when the sort key is unchanged', () => {
    const { renderer, writes } = fakeRenderer();
    const src = makeSource({ 0: 10, 1: 20, 2: 30 });
    const idx = makeIndex();
    idx.addMember(e(1), slot(0), { bucketKey: 0, worldZ: 5, image: 1 });
    idx.addMember(e(2), slot(1), { bucketKey: 0, worldZ: 3, image: 1 });
    idx.addMember(e(3), slot(2), { bucketKey: 0, worldZ: 9, image: 1 });
    idx.prepare(src, renderer);

    // e1 changes UV (data only); worldZ/bucket/image unchanged → in-place at its ordered pos (1).
    writes.length = 0;
    src.scratchF32[src.floatOffsetOf(0)] = 99;
    idx.updateMember(e(1), { bucketKey: 0, worldZ: 5, image: 1 }, src);
    idx.prepare(src, renderer);

    expect(orderedSentinel(idx, 1)).toBe(99);
    expect(writes).toEqual([{ offset: 1 * STRIDE, bytes: 1 * STRIDE }]); // partial, not a rebuild
  });

  it('re-sorts when a member key changes', () => {
    const { renderer } = fakeRenderer();
    const src = makeSource({ 0: 10, 1: 20, 2: 30 });
    const idx = makeIndex();
    idx.addMember(e(1), slot(0), { bucketKey: 0, worldZ: 5, image: 1 });
    idx.addMember(e(2), slot(1), { bucketKey: 0, worldZ: 3, image: 1 });
    idx.addMember(e(3), slot(2), { bucketKey: 0, worldZ: 9, image: 1 });
    idx.prepare(src, renderer);

    // e3 moves to the front (smallest worldZ) → new order e1(5), e2(3), e3(1).
    idx.updateMember(e(3), { bucketKey: 0, worldZ: 1, image: 1 }, src);
    idx.prepare(src, renderer);

    expect(orderedSentinel(idx, 0)).toBe(10); // e1
    expect(orderedSentinel(idx, 1)).toBe(20); // e2
    expect(orderedSentinel(idx, 2)).toBe(30); // e3
  });

  it('breaks batches across image and bucket boundaries', () => {
    const { renderer } = fakeRenderer();
    const src = makeSource({ 0: 1, 1: 2, 2: 3 });
    const idx = makeIndex();
    // Same bucket, two images interleaved by Z: A@9, B@5, A@3 → three batches.
    idx.addMember(e(1), slot(0), { bucketKey: 0, worldZ: 9, image: 1 });
    idx.addMember(e(2), slot(1), { bucketKey: 0, worldZ: 5, image: 2 });
    idx.addMember(e(3), slot(2), { bucketKey: 0, worldZ: 3, image: 1 });
    idx.prepare(src, renderer);
    expect(idx.batches.map((b) => b.count)).toEqual([1, 1, 1]);

    // Opaque (0) sorts before blend (1) regardless of Z. With B pushed to the
    // blend bucket, the two image-1 opaque sprites (e1@9, e3@3) become adjacent
    // and merge — leaving one opaque batch then one blend batch.
    idx.updateMember(e(2), { bucketKey: 1, worldZ: 5, image: 2 }, src);
    idx.prepare(src, renderer);
    expect(idx.batches.map((b) => b.key.bucketKey)).toEqual([0, 1]);
    expect(idx.batches.map((b) => b.count)).toEqual([2, 1]);
  });

  it('lays out a 9-slice member as nine contiguous ordered instances', () => {
    const { renderer } = fakeRenderer();
    const src = makeSource({ 0: 1, 1: 100 });
    const idx = makeIndex();
    idx.addMember(e(1), slot(0, 1), { bucketKey: 0, worldZ: 9, image: 1 });
    idx.addMember(e(2), slot(1, 9), { bucketKey: 0, worldZ: 3, image: 1 }); // 9-slice run
    idx.prepare(src, renderer);

    expect(idx.batches).toHaveLength(1);
    expect(idx.batches[0]!.count).toBe(10); // 1 + 9
    expect(orderedSentinel(idx, 0)).toBe(1); // e1 back-most
    expect(orderedSentinel(idx, 1)).toBe(100); // e2's run starts at ordered pos 1
  });

  it('drops a removed member from the next rebuild', () => {
    const { renderer } = fakeRenderer();
    const src = makeSource({ 0: 10, 1: 20, 2: 30 });
    const idx = makeIndex();
    idx.addMember(e(1), slot(0), { bucketKey: 0, worldZ: 5, image: 1 });
    idx.addMember(e(2), slot(1), { bucketKey: 0, worldZ: 3, image: 1 });
    idx.addMember(e(3), slot(2), { bucketKey: 0, worldZ: 9, image: 1 });
    idx.prepare(src, renderer);

    idx.removeMember(e(3)); // the back-most
    idx.prepare(src, renderer);
    expect(idx.batches[0]!.count).toBe(2);
    expect(idx.has(e(3))).toBe(false);
    expect(orderedSentinel(idx, 0)).toBe(10); // e1 now back-most
    expect(orderedSentinel(idx, 1)).toBe(20);
  });
});
