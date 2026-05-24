import { describe, expect, it } from 'bun:test';

import { Mesh } from './mesh';
import { Meshes } from './meshes';

describe('Meshes registry', () => {
  it('returns a fresh handle on add and emits an Added event', () => {
    const meshes = new Meshes();
    const handle = meshes.add(new Mesh({ label: 'test' }));
    expect(handle).toBeDefined();
    expect(meshes.has(handle)).toBe(true);
    expect(meshes.size).toBe(1);
    const events = meshes.drainPendingChanges();
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ kind: 'added', handle });
  });

  it('get returns the mesh round-trip', () => {
    const mesh = new Mesh({ label: 'round-trip' });
    const meshes = new Meshes();
    const handle = meshes.add(mesh);
    expect(meshes.get(handle)).toBe(mesh);
  });

  it('mutate runs fn and queues a Modified event', () => {
    const meshes = new Meshes();
    const handle = meshes.add(new Mesh());
    meshes.drainPendingChanges();
    const ran = meshes.mutate(handle, (m) => {
      m.primitiveTopology = 'line-list';
    });
    expect(ran).toBe(true);
    expect(meshes.get(handle)?.primitiveTopology).toBe('line-list');
    expect(meshes.drainPendingChanges()).toEqual([{ kind: 'modified', handle }]);
  });

  it('mutate is a no-op on unknown handle (no event emitted, returns false)', () => {
    const meshes = new Meshes();
    const handle = meshes.add(new Mesh());
    meshes.drainPendingChanges();
    meshes.remove(handle);
    meshes.drainPendingChanges();
    const ran = meshes.mutate(handle, () => undefined);
    expect(ran).toBe(false);
    expect(meshes.drainPendingChanges()).toEqual([]);
  });

  it('remove emits a Removed event once; double-remove is a no-op', () => {
    const meshes = new Meshes();
    const handle = meshes.add(new Mesh());
    meshes.drainPendingChanges();
    meshes.remove(handle);
    expect(meshes.drainPendingChanges()).toEqual([{ kind: 'removed', handle }]);
    meshes.remove(handle); // double-remove
    expect(meshes.drainPendingChanges()).toEqual([]);
    expect(meshes.has(handle)).toBe(false);
    expect(meshes.size).toBe(0);
  });

  it('drainPendingChanges clears the buffer', () => {
    const meshes = new Meshes();
    meshes.add(new Mesh());
    meshes.add(new Mesh());
    expect(meshes.drainPendingChanges()).toHaveLength(2);
    expect(meshes.drainPendingChanges()).toHaveLength(0);
  });

  it('iter enumerates registered (handle, mesh) pairs in insertion order', () => {
    const meshes = new Meshes();
    const a = new Mesh({ label: 'a' });
    const b = new Mesh({ label: 'b' });
    const c = new Mesh({ label: 'c' });
    const ha = meshes.add(a);
    const hb = meshes.add(b);
    const hc = meshes.add(c);
    const entries = [...meshes.iter()];
    expect(entries).toEqual([
      [ha, a],
      [hb, b],
      [hc, c],
    ]);
  });
});
