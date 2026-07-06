import { describe, expect, it } from 'bun:test';

import type { AssetGuid, AssetManifest, AssetManifestEntry } from '@retro-engine/assets';
import { writeRpak } from '@retro-engine/build';
import type { RangeFetch } from '@retro-engine/build/rpak';
import { RangeRpakReader } from '@retro-engine/build/rpak';

import { RpakAssetSource } from './rpak-asset-source';

const manifestOf = (entries: readonly AssetManifestEntry[]): AssetManifest => ({
  entries: new Map(entries.map((e) => [e.guid, e])),
});

const sourceOver = async (
  archive: readonly { guid: string; location: string; kind: string; data: Uint8Array }[],
): Promise<RpakAssetSource> => {
  const bytes = await writeRpak(archive.map((a) => ({ guid: a.guid, data: a.data })));
  const fetch: RangeFetch = async (start, end) => bytes.subarray(start, end);
  const reader = new RangeRpakReader(fetch);
  const manifest = manifestOf(
    archive.map((a) => ({ guid: a.guid as AssetGuid, location: a.location, kind: a.kind })),
  );
  return new RpakAssetSource(reader, manifest);
};

describe('RpakAssetSource', () => {
  it('reads a packed asset by its manifest location', async () => {
    const data = new TextEncoder().encode('hello packed asset');
    const source = await sourceOver([{ guid: 'g1', location: 'assets/a.txt', kind: 'Text', data }]);
    expect(new TextDecoder().decode(await source.read('assets/a.txt'))).toBe('hello packed asset');
  });

  it('resolves the right entry among several', async () => {
    const source = await sourceOver([
      { guid: 'g1', location: 'assets/a.bin', kind: 'Blob', data: new Uint8Array([1, 2]) },
      { guid: 'g2', location: 'assets/b.bin', kind: 'Blob', data: new Uint8Array([9, 8, 7]) },
    ]);
    expect(Array.from(await source.read('assets/b.bin'))).toEqual([9, 8, 7]);
  });

  it('throws for a location with no packed asset', async () => {
    const source = await sourceOver([
      { guid: 'g1', location: 'assets/a.txt', kind: 'Text', data: new Uint8Array([0]) },
    ]);
    await expect(source.read('assets/missing.txt')).rejects.toThrow(/no packed asset/);
  });
});
