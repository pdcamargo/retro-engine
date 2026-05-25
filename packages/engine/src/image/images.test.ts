import { describe, expect, it } from 'bun:test';

import { vec4 } from '@retro-engine/math';

import { Image } from './image';
import { Images } from './images';

describe('Images registry', () => {
  it('seeds WHITE, BLACK, NORMAL_FLAT in the constructor', () => {
    const images = new Images();
    expect(images.has(images.WHITE)).toBe(true);
    expect(images.has(images.BLACK)).toBe(true);
    expect(images.has(images.NORMAL_FLAT)).toBe(true);
    expect(images.size).toBe(3);
    const white = images.get(images.WHITE);
    expect(white?.label).toBe('image#WHITE');
    expect(Array.from(white!.data)).toEqual([0xff, 0xff, 0xff, 0xff]);
    const black = images.get(images.BLACK);
    expect(Array.from(black!.data)).toEqual([0x00, 0x00, 0x00, 0xff]);
    const normalFlat = images.get(images.NORMAL_FLAT);
    expect(Array.from(normalFlat!.data)).toEqual([0x80, 0x80, 0xff, 0xff]);
  });

  it('queues one Added event per default handle on construction', () => {
    const images = new Images();
    const events = images.drainPendingChanges();
    expect(events).toHaveLength(3);
    expect(events[0]).toEqual({ kind: 'added', handle: images.WHITE });
    expect(events[1]).toEqual({ kind: 'added', handle: images.BLACK });
    expect(events[2]).toEqual({ kind: 'added', handle: images.NORMAL_FLAT });
  });

  it('returns a fresh handle on add and emits an Added event', () => {
    const images = new Images();
    images.drainPendingChanges(); // discard the seeded defaults
    const handle = images.add(Image.solid(vec4.create(1, 0, 0, 1), undefined, 'red'));
    expect(images.has(handle)).toBe(true);
    expect(images.size).toBe(4);
    const events = images.drainPendingChanges();
    expect(events).toEqual([{ kind: 'added', handle }]);
  });

  it('get returns the image round-trip', () => {
    const image = Image.solid(vec4.create(0.2, 0.4, 0.6, 1));
    const images = new Images();
    const handle = images.add(image);
    expect(images.get(handle)).toBe(image);
  });

  it('replace swaps the image and queues a Modified event', () => {
    const images = new Images();
    const a = Image.solid(vec4.create(1, 0, 0, 1));
    const b = Image.solid(vec4.create(0, 1, 0, 1));
    const handle = images.add(a);
    images.drainPendingChanges();
    const swapped = images.replace(handle, b);
    expect(swapped).toBe(true);
    expect(images.get(handle)).toBe(b);
    expect(images.drainPendingChanges()).toEqual([{ kind: 'modified', handle }]);
  });

  it('replace is a no-op on unknown handle (no event emitted, returns false)', () => {
    const images = new Images();
    const handle = images.add(Image.solid(vec4.create(1, 1, 1, 1)));
    images.drainPendingChanges();
    images.remove(handle);
    images.drainPendingChanges();
    const swapped = images.replace(handle, Image.solid(vec4.create(0, 0, 0, 1)));
    expect(swapped).toBe(false);
    expect(images.drainPendingChanges()).toEqual([]);
  });

  it('remove emits a Removed event once; double-remove is a no-op', () => {
    const images = new Images();
    const handle = images.add(Image.solid(vec4.create(1, 1, 1, 1)));
    images.drainPendingChanges();
    images.remove(handle);
    expect(images.drainPendingChanges()).toEqual([{ kind: 'removed', handle }]);
    images.remove(handle); // double-remove
    expect(images.drainPendingChanges()).toEqual([]);
    expect(images.has(handle)).toBe(false);
  });

  it('drainPendingChanges clears the buffer', () => {
    const images = new Images();
    images.drainPendingChanges();
    images.add(Image.solid(vec4.create(1, 0, 0, 1)));
    images.add(Image.solid(vec4.create(0, 1, 0, 1)));
    expect(images.drainPendingChanges()).toHaveLength(2);
    expect(images.drainPendingChanges()).toHaveLength(0);
  });

  it('iter enumerates (handle, image) pairs in insertion order, starting with the defaults', () => {
    const images = new Images();
    const extra = Image.solid(vec4.create(1, 0.5, 0, 1));
    const handle = images.add(extra);
    const entries = [...images.iter()];
    expect(entries).toHaveLength(4);
    expect(entries[0]![0]).toBe(images.WHITE);
    expect(entries[1]![0]).toBe(images.BLACK);
    expect(entries[2]![0]).toBe(images.NORMAL_FLAT);
    expect(entries[3]![0]).toBe(handle);
    expect(entries[3]![1]).toBe(extra);
  });
});
