import { describe, expect, it } from 'bun:test';

import { Mesh } from './mesh';
import { Meshes } from './meshes';

describe('Meshes store', () => {
  it('returns a fresh handle on add and emits an added event', () => {
    const meshes = new Meshes();
    const handle = meshes.add(new Mesh({ label: 'test' }));
    expect(handle).toBeDefined();
    expect(meshes.has(handle)).toBe(true);
    expect(meshes.size).toBe(1);
    const events = meshes.drainEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ kind: 'added', handle });
  });

  it('get returns the mesh round-trip', () => {
    const mesh = new Mesh({ label: 'round-trip' });
    const meshes = new Meshes();
    const handle = meshes.add(mesh);
    expect(meshes.get(handle)).toBe(mesh);
  });

  it('getMut returns the value for in-place mutation and queues a modified event', () => {
    const meshes = new Meshes();
    const handle = meshes.add(new Mesh());
    meshes.drainEvents();
    const mesh = meshes.getMut(handle);
    expect(mesh).toBeDefined();
    mesh!.primitiveTopology = 'line-list';
    expect(meshes.get(handle)?.primitiveTopology).toBe('line-list');
    expect(meshes.drainEvents()).toEqual([{ kind: 'modified', handle }]);
  });

  it('getMut returns undefined on a removed handle and emits no event', () => {
    const meshes = new Meshes();
    const handle = meshes.add(new Mesh());
    meshes.remove(handle);
    meshes.drainEvents();
    expect(meshes.getMut(handle)).toBeUndefined();
    expect(meshes.drainEvents()).toEqual([]);
  });

  it('remove emits a removed event once; double-remove is a no-op', () => {
    const meshes = new Meshes();
    const handle = meshes.add(new Mesh());
    meshes.drainEvents();
    meshes.remove(handle);
    expect(meshes.drainEvents()).toEqual([{ kind: 'removed', handle }]);
    meshes.remove(handle); // double-remove
    expect(meshes.drainEvents()).toEqual([]);
    expect(meshes.has(handle)).toBe(false);
    expect(meshes.size).toBe(0);
  });

  it('drainEvents clears the buffer', () => {
    const meshes = new Meshes();
    meshes.add(new Mesh());
    meshes.add(new Mesh());
    expect(meshes.drainEvents()).toHaveLength(2);
    expect(meshes.drainEvents()).toHaveLength(0);
  });

  it('iter enumerates registered (index, mesh) pairs in insertion order', () => {
    const meshes = new Meshes();
    const a = new Mesh({ label: 'a' });
    const b = new Mesh({ label: 'b' });
    const c = new Mesh({ label: 'c' });
    const ha = meshes.add(a);
    const hb = meshes.add(b);
    const hc = meshes.add(c);
    const entries = [...meshes.iter()];
    expect(entries).toEqual([
      [ha.index, a],
      [hb.index, b],
      [hc.index, c],
    ]);
  });
});
