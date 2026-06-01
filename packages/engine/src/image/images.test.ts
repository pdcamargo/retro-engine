import { describe, expect, it } from 'bun:test';

import { vec4 } from '@retro-engine/math';

import { Image } from './image';
import { Images } from './images';

describe('Images store', () => {
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

  it('queues one added event per default handle on construction', () => {
    const images = new Images();
    const events = images.drainEvents();
    expect(events).toHaveLength(3);
    expect(events[0]).toEqual({ kind: 'added', handle: images.WHITE });
    expect(events[1]).toEqual({ kind: 'added', handle: images.BLACK });
    expect(events[2]).toEqual({ kind: 'added', handle: images.NORMAL_FLAT });
  });

  it('returns a fresh handle on add and emits an added event', () => {
    const images = new Images();
    images.drainEvents(); // discard the seeded defaults
    const handle = images.add(Image.solid(vec4.create(1, 0, 0, 1), { label: 'red' }));
    expect(images.has(handle)).toBe(true);
    expect(images.size).toBe(4);
    const events = images.drainEvents();
    expect(events).toEqual([{ kind: 'added', handle }]);
  });

  it('get returns the image round-trip', () => {
    const image = Image.solid(vec4.create(0.2, 0.4, 0.6, 1));
    const images = new Images();
    const handle = images.add(image);
    expect(images.get(handle)).toBe(image);
  });

  it('insert overwrites an existing handle and queues a modified event', () => {
    const images = new Images();
    const a = Image.solid(vec4.create(1, 0, 0, 1));
    const b = Image.solid(vec4.create(0, 1, 0, 1));
    const handle = images.add(a);
    images.drainEvents();
    images.insert(handle, b);
    expect(images.get(handle)).toBe(b);
    expect(images.drainEvents()).toEqual([{ kind: 'modified', handle }]);
  });

  it('remove emits a removed event once; double-remove is a no-op', () => {
    const images = new Images();
    const handle = images.add(Image.solid(vec4.create(1, 1, 1, 1)));
    images.drainEvents();
    images.remove(handle);
    expect(images.drainEvents()).toEqual([{ kind: 'removed', handle }]);
    images.remove(handle); // double-remove
    expect(images.drainEvents()).toEqual([]);
    expect(images.has(handle)).toBe(false);
  });

  it('drainEvents clears the buffer', () => {
    const images = new Images();
    images.drainEvents();
    images.add(Image.solid(vec4.create(1, 0, 0, 1)));
    images.add(Image.solid(vec4.create(0, 1, 0, 1)));
    expect(images.drainEvents()).toHaveLength(2);
    expect(images.drainEvents()).toHaveLength(0);
  });

  it('iter enumerates (index, image) pairs in insertion order, starting with the defaults', () => {
    const images = new Images();
    const extra = Image.solid(vec4.create(1, 0.5, 0, 1));
    const handle = images.add(extra);
    const entries = [...images.iter()];
    expect(entries).toHaveLength(4);
    expect(entries[0]![0]).toBe(images.WHITE.index);
    expect(entries[1]![0]).toBe(images.BLACK.index);
    expect(entries[2]![0]).toBe(images.NORMAL_FLAT.index);
    expect(entries[3]![0]).toBe(handle.index);
    expect(entries[3]![1]).toBe(extra);
  });
});
