import { describe, expect, it } from 'bun:test';

import { AssetKinds } from './asset-kinds';

describe('AssetKinds', () => {
  it('indexes a discoverable kind by each claimed extension', () => {
    const k = new AssetKinds();
    k.register({ kind: 'Gltf', extensions: ['glb', 'GLTF'], discoverable: true });
    expect(k.forExtension('glb')?.kind).toBe('Gltf');
    expect(k.forExtension('gltf')?.kind).toBe('Gltf'); // case-insensitive
    expect(k.get('Gltf')?.category).toBeUndefined();
  });

  it('does not index a non-discoverable kind for discovery', () => {
    const k = new AssetKinds();
    k.register({ kind: 'Mesh', extensions: ['rmesh'], discoverable: false });
    expect(k.forExtension('rmesh')).toBeUndefined();
    expect(k.get('Mesh')?.kind).toBe('Mesh');
  });

  it('lets several non-discoverable kinds share an extension (the materials case)', () => {
    const k = new AssetKinds();
    k.register({ kind: 'StandardMaterial', extensions: ['remat'], discoverable: false });
    expect(() =>
      k.register({ kind: 'UnlitMaterial', extensions: ['remat'], discoverable: false }),
    ).not.toThrow();
  });

  it('throws when two discoverable kinds claim the same extension', () => {
    const k = new AssetKinds();
    k.register({ kind: 'Gltf', extensions: ['glb'], discoverable: true });
    expect(() => k.register({ kind: 'Other', extensions: ['glb'], discoverable: true })).toThrow();
  });

  it('lists every claimed extension once', () => {
    const k = new AssetKinds();
    k.register({ kind: 'Image', extensions: ['png', 'jpg'], discoverable: true });
    k.register({ kind: 'Gltf', extensions: ['glb'], discoverable: true });
    expect([...k.extensions()].sort()).toEqual(['glb', 'jpg', 'png']);
  });
});
