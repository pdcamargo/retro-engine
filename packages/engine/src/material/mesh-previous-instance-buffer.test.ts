import { describe, expect, it } from 'bun:test';

import { PREVIOUS_INSTANCE_BYTE_SIZE, PREVIOUS_INSTANCE_FLOAT_COUNT } from './instance-layout';
import { MeshPreviousInstanceBuffer } from './mesh-previous-instance-buffer';
import { makeHeadlessRenderer } from '../test-utils';

describe('MeshPreviousInstanceBuffer', () => {
  it('starts empty — no GPU buffer or scratch allocated', () => {
    const b = new MeshPreviousInstanceBuffer();
    expect(b.buffer).toBeUndefined();
    expect(b.capacity).toBe(0);
    expect(b.count).toBe(0);
    expect(b.scratchF32.length).toBe(0);
  });

  it('lazily allocates a GPU buffer on the first ensureCapacity call', () => {
    const b = new MeshPreviousInstanceBuffer();
    const renderer = makeHeadlessRenderer();
    b.ensureCapacity(renderer, 4);
    expect(b.buffer).toBeDefined();
    // Minimum capacity is 64 even when fewer instances are requested.
    expect(b.capacity).toBeGreaterThanOrEqual(64);
    expect(b.scratchF32.length).toBeGreaterThanOrEqual(
      b.capacity * PREVIOUS_INSTANCE_FLOAT_COUNT,
    );
    expect(b.buffer!.size).toBe(b.capacity * PREVIOUS_INSTANCE_BYTE_SIZE);
  });

  it('grows the buffer and parks the prior one in pendingDestroy when capacity is insufficient', () => {
    const b = new MeshPreviousInstanceBuffer();
    const renderer = makeHeadlessRenderer();
    b.ensureCapacity(renderer, 4);
    const firstBuffer = b.buffer;
    const firstCapacity = b.capacity;
    expect(firstBuffer).toBeDefined();

    // Request capacity well above the existing slot count to force a resize.
    b.ensureCapacity(renderer, firstCapacity + 100);
    expect(b.buffer).toBeDefined();
    expect(b.buffer).not.toBe(firstBuffer);
    expect(b.capacity).toBeGreaterThanOrEqual(firstCapacity + 100);
    // Prior buffer is deferred-destroyed for one frame so an in-flight
    // submission cannot reference a destroyed GPU resource.
    expect(b.pendingDestroy).toBe(firstBuffer);
  });

  it('reaps the prior pending-destroy buffer on the next ensureCapacity', () => {
    const b = new MeshPreviousInstanceBuffer();
    const renderer = makeHeadlessRenderer();
    b.ensureCapacity(renderer, 4);
    b.ensureCapacity(renderer, 200);
    expect(b.pendingDestroy).toBeDefined();
    // Next ensure (even a no-op one) reaps the prior buffer.
    b.ensureCapacity(renderer, 4);
    expect(b.pendingDestroy).toBeUndefined();
  });

  it('dispose drops both the active and the deferred buffers', () => {
    const b = new MeshPreviousInstanceBuffer();
    const renderer = makeHeadlessRenderer();
    b.ensureCapacity(renderer, 4);
    b.ensureCapacity(renderer, 200);
    b.dispose();
    expect(b.buffer).toBeUndefined();
    expect(b.pendingDestroy).toBeUndefined();
    expect(b.capacity).toBe(0);
    expect(b.count).toBe(0);
  });
});
