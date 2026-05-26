import { describe, expect, it } from 'bun:test';

import type { Entity } from '@retro-engine/ecs';
import type { Buffer, Renderer } from '@retro-engine/renderer-core';

import { RetainedInstanceBuffer } from './retained-instance-buffer';

const e = (n: number): Entity => n as Entity;

/** Stride of 8 bytes = 2 floats per instance keeps the offset arithmetic obvious. */
const STRIDE = 8;
const FPI = STRIDE / 4;

interface Write {
  offset: number;
  bytes: number;
}

const fakeRenderer = (): { renderer: Renderer; writes: Write[]; created: () => number } => {
  const writes: Write[] = [];
  let created = 0;
  const renderer = {
    createBuffer: () => {
      created += 1;
      return { destroy() {} } as unknown as Buffer;
    },
    writeBuffer: (_buffer: Buffer, offset: number, data: BufferSource) => {
      writes.push({ offset, bytes: (data as ArrayBufferView).byteLength });
    },
  } as unknown as Renderer;
  return { renderer, writes, created: () => created };
};

/** Pack a recognizable sentinel into instance `first`'s first float. */
const packSentinel = (buf: RetainedInstanceBuffer, first: number, value: number): void => {
  buf.scratchF32[buf.floatOffsetOf(first)] = value;
};

describe('RetainedInstanceBuffer', () => {
  it('seeds the GPU buffer with one full upload on the first flush', () => {
    const { renderer, writes } = fakeRenderer();
    const buf = new RetainedInstanceBuffer(STRIDE, 'test');
    for (const id of [1, 2, 3]) {
      const slot = buf.slots.alloc(e(id), 1);
      buf.markDirty(slot.first, slot.len);
    }
    buf.ensureCapacity(renderer);
    buf.flush(renderer);

    expect(writes).toEqual([{ offset: 0, bytes: 3 * STRIDE }]); // capacity = 3 live instances
  });

  it('uploads only the dirty range in steady state', () => {
    const { renderer, writes } = fakeRenderer();
    const buf = new RetainedInstanceBuffer(STRIDE, 'test');
    for (const id of [1, 2, 3]) buf.slots.alloc(e(id), 1);
    buf.ensureCapacity(renderer);
    buf.flush(renderer); // frame 1: full seed

    writes.length = 0;
    const slot = buf.slots.get(e(2))!; // first = 1
    buf.markDirty(slot.first, slot.len);
    buf.ensureCapacity(renderer); // no grow
    buf.flush(renderer);

    expect(writes).toEqual([{ offset: 1 * STRIDE, bytes: 1 * STRIDE }]);
  });

  it('coalesces touching dirty runs and splits disjoint ones', () => {
    const { renderer, writes } = fakeRenderer();
    const buf = new RetainedInstanceBuffer(STRIDE, 'test');
    for (let i = 0; i < 10; i++) buf.slots.alloc(e(i), 1);
    buf.ensureCapacity(renderer);
    buf.flush(renderer);

    // Adjacent 0 and 1 → one run; 5 separated → its own run. 3 dirty < 50% of 10.
    writes.length = 0;
    buf.markDirty(1, 1);
    buf.markDirty(0, 1);
    buf.markDirty(5, 1);
    buf.flush(renderer);

    expect(writes).toEqual([
      { offset: 0, bytes: 2 * STRIDE },
      { offset: 5 * STRIDE, bytes: 1 * STRIDE },
    ]);
  });

  it('falls back to a single full upload past the dirty-volume threshold', () => {
    const { renderer, writes } = fakeRenderer();
    const buf = new RetainedInstanceBuffer(STRIDE, 'test');
    for (let i = 0; i < 10; i++) buf.slots.alloc(e(i), 1);
    buf.ensureCapacity(renderer);
    buf.flush(renderer);

    writes.length = 0;
    for (let i = 0; i < 6; i++) buf.markDirty(i, 1); // 6 > 50% of 10
    buf.flush(renderer);

    expect(writes).toEqual([{ offset: 0, bytes: 10 * STRIDE }]);
  });

  it('preserves scratch contents across a grow', () => {
    const { renderer } = fakeRenderer();
    const buf = new RetainedInstanceBuffer(STRIDE, 'test');
    buf.slots.alloc(e(1), 1);
    buf.ensureCapacity(renderer); // capacity bumps to MIN_CAPACITY (64)
    packSentinel(buf, 0, 42);

    for (let i = 2; i <= 70; i++) buf.slots.alloc(e(i), 1); // force past 64
    buf.ensureCapacity(renderer); // grows + copies

    expect(buf.scratchF32[buf.floatOffsetOf(0)]).toBe(42);
    expect(buf.capacity).toBeGreaterThanOrEqual(70);
  });

  it('relocates bytes and forces a full upload on compact', () => {
    const { renderer, writes } = fakeRenderer();
    const buf = new RetainedInstanceBuffer(STRIDE, 'test');
    buf.slots.alloc(e(1), 1); // first 0
    buf.slots.alloc(e(2), 1); // first 1
    buf.slots.alloc(e(3), 1); // first 2
    buf.ensureCapacity(renderer);
    packSentinel(buf, 0, 10);
    packSentinel(buf, 1, 20);
    packSentinel(buf, 2, 30);
    buf.flush(renderer);

    buf.slots.free(e(2)); // hole at 1
    buf.compact(); // e(3) slides 2 -> 1

    expect(buf.slots.get(e(3))!.first).toBe(1);
    expect(buf.scratchF32[buf.floatOffsetOf(1)]).toBe(30); // e(3)'s sentinel moved
    expect(buf.scratchF32[buf.floatOffsetOf(0)]).toBe(10); // e(1) untouched

    writes.length = 0;
    buf.ensureCapacity(renderer);
    buf.flush(renderer);
    expect(writes).toEqual([{ offset: 0, bytes: 2 * STRIDE }]); // full, capacity now 2
  });

  it('aliases scratchF32 and scratchU32 over the same buffer', () => {
    const { renderer } = fakeRenderer();
    const buf = new RetainedInstanceBuffer(STRIDE, 'test');
    buf.slots.alloc(e(1), 1);
    buf.ensureCapacity(renderer);
    buf.scratchU32[FPI - 1] = 0xdeadbeef;
    expect(buf.scratchF32.buffer).toBe(buf.scratchU32.buffer);
  });
});
