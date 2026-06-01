import { describe, expect, it } from 'bun:test';

import { Assets } from './assets';

interface Mesh {
  readonly label: string;
}

const mesh = (label: string): Mesh => ({ label });

describe('Assets.add', () => {
  it('mints monotonic indices with no reuse', () => {
    const assets = new Assets<Mesh>();
    const a = assets.add(mesh('a'));
    const b = assets.add(mesh('b'));
    expect(b.index).toBeGreaterThan(a.index);

    assets.remove(a);
    const c = assets.add(mesh('c'));
    // Removed slot is not recycled — the new index keeps climbing.
    expect(c.index).toBeGreaterThan(b.index);
  });

  it('queues an added event resolvable via get', () => {
    const assets = new Assets<Mesh>();
    const handle = assets.add(mesh('a'));
    expect(assets.get(handle)).toEqual(mesh('a'));
    expect(assets.drainEvents()).toEqual([{ kind: 'added', handle }]);
  });
});

describe('Assets.getMut', () => {
  it('queues exactly one modified event and returns the live value', () => {
    const assets = new Assets<Mesh>();
    const handle = assets.add(mesh('a'));
    assets.drainEvents();

    const value = assets.getMut(handle);
    // Returned reference is the stored value, ready for in-place mutation.
    expect(value).toBe(assets.get(handle));
    expect(value).toEqual(mesh('a'));
    expect(assets.drainEvents()).toEqual([{ kind: 'modified', handle }]);
  });

  it('queues nothing and returns undefined for an unknown handle', () => {
    const assets = new Assets<Mesh>();
    const handle = assets.add(mesh('a'));
    assets.remove(handle);
    assets.drainEvents();

    expect(assets.getMut(handle)).toBeUndefined();
    expect(assets.drainEvents()).toEqual([]);
  });
});

describe('Assets.remove', () => {
  it('queues a removed event and clears the slot', () => {
    const assets = new Assets<Mesh>();
    const handle = assets.add(mesh('a'));
    assets.drainEvents();

    assets.remove(handle);
    expect(assets.get(handle)).toBeUndefined();
    expect(assets.has(handle)).toBe(false);
    expect(assets.drainEvents()).toEqual([{ kind: 'removed', handle }]);
  });

  it('is a silent no-op for an unknown handle', () => {
    const assets = new Assets<Mesh>();
    const handle = assets.add(mesh('a'));
    assets.remove(handle);
    assets.drainEvents();

    assets.remove(handle);
    expect(assets.drainEvents()).toEqual([]);
  });
});

describe('Assets.reserveHandle', () => {
  it('yields a handle that resolves once inserted', () => {
    const assets = new Assets<Mesh>();
    const handle = assets.reserveHandle();
    // Reserving alone neither stores a value nor queues an event.
    expect(assets.get(handle)).toBeUndefined();
    expect(assets.drainEvents()).toEqual([]);

    assets.insert(handle, mesh('late'));
    expect(assets.get(handle)).toEqual(mesh('late'));
    // Filling an empty reserved slot reads as an addition.
    expect(assets.drainEvents()).toEqual([{ kind: 'added', handle }]);
  });

  it('does not collide with indices minted by add', () => {
    const assets = new Assets<Mesh>();
    const reserved = assets.reserveHandle();
    const added = assets.add(mesh('a'));
    expect(reserved.index).not.toBe(added.index);
  });
});

describe('Assets.insert', () => {
  it('queues modified when overwriting an existing value', () => {
    const assets = new Assets<Mesh>();
    const handle = assets.add(mesh('a'));
    assets.drainEvents();

    assets.insert(handle, mesh('b'));
    expect(assets.get(handle)).toEqual(mesh('b'));
    expect(assets.drainEvents()).toEqual([{ kind: 'modified', handle }]);
  });
});

describe('Assets.drainEvents', () => {
  it('drains once and clears', () => {
    const assets = new Assets<Mesh>();
    assets.add(mesh('a'));
    assets.add(mesh('b'));

    expect(assets.drainEvents()).toHaveLength(2);
    expect(assets.drainEvents()).toEqual([]);
  });
});
