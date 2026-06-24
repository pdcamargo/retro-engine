import { describe, expect, it } from 'bun:test';

import { AssetKinds } from '../asset/asset-kinds';

import { generateMissingSidecars } from './generate-sidecars';
import { parseMeta } from './meta';

const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

const kinds = (): AssetKinds => {
  const k = new AssetKinds();
  k.register({ kind: 'Gltf', extensions: ['glb', 'gltf'], discoverable: true, category: 'model' });
  k.register({ kind: 'Mesh', extensions: ['rmesh'], discoverable: false, category: 'mesh' });
  k.register({
    kind: 'Image',
    extensions: ['png'],
    discoverable: true,
    category: 'image',
    defaultMeta: () => ({ sprites: [] }),
  });
  return k;
};

describe('generateMissingSidecars', () => {
  it('mints a sidecar for a loose discoverable asset with a fresh GUID and the right kind', () => {
    const { writes, minted } = generateMissingSidecars(['models/hero.glb'], kinds());
    expect(writes.length).toBe(1);
    expect(writes[0]!.location).toBe('models/hero.glb.meta');
    const meta = parseMeta(decode(writes[0]!.bytes));
    expect(meta.kind).toBe('Gltf');
    expect(typeof meta.guid).toBe('string');
    expect(meta.guid.length).toBeGreaterThan(0);
    expect(minted).toEqual([{ guid: meta.guid, location: 'models/hero.glb', kind: 'Gltf' }]);
  });

  it('is idempotent — a file that already has a sibling .meta is skipped', () => {
    const files = ['models/hero.glb', 'models/hero.glb.meta'];
    const { writes } = generateMissingSidecars(files, kinds());
    expect(writes.length).toBe(0);
  });

  it('does not mint for a non-discoverable kind', () => {
    const { writes } = generateMissingSidecars(['meshes/box.rmesh'], kinds());
    expect(writes.length).toBe(0);
  });

  it('ignores files whose extension no kind claims', () => {
    const { writes } = generateMissingSidecars(['notes/readme.txt', 'data.bin'], kinds());
    expect(writes.length).toBe(0);
  });

  it("populates the sidecar's data body from the descriptor's defaultMeta", () => {
    const { writes } = generateMissingSidecars(['art/hero.png'], kinds());
    expect(writes.length).toBe(1);
    expect(parseMeta(decode(writes[0]!.bytes)).data).toEqual({ sprites: [] });
  });

  it('mints for several loose assets at once and skips already-covered ones', () => {
    const files = ['a.glb', 'b.gltf', 'c.glb', 'c.glb.meta'];
    const { writes, minted } = generateMissingSidecars(files, kinds());
    expect(writes.map((w) => w.location).sort()).toEqual(['a.glb.meta', 'b.gltf.meta']);
    expect(minted.length).toBe(2);
  });
});
