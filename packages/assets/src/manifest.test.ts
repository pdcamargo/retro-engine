import { describe, expect, it } from 'bun:test';

import type { AssetGuid } from './asset-id';
import { MANIFEST_FORMAT_VERSION, parseAssetManifest } from './manifest';

const entry = (guid: string, location: string, kind: string) => ({ guid, location, kind });
const file = (entries: ReturnType<typeof entry>[], version = MANIFEST_FORMAT_VERSION): string =>
  JSON.stringify({ version, entries });

describe('parseAssetManifest', () => {
  it('folds entries into a guid-keyed index', () => {
    const manifest = parseAssetManifest(
      file([entry('g1', 'meshes/a.mesh', 'Mesh'), entry('g2', 'mats/b.smat', 'StandardMaterial')]),
    );
    expect(manifest.entries.size).toBe(2);
    expect(manifest.entries.get('g1' as AssetGuid)?.location).toBe('meshes/a.mesh');
    expect(manifest.entries.get('g2' as AssetGuid)?.kind).toBe('StandardMaterial');
  });

  it('throws on malformed JSON', () => {
    expect(() => parseAssetManifest('{ not json')).toThrow();
  });

  it('throws on a version mismatch', () => {
    expect(() => parseAssetManifest(file([], MANIFEST_FORMAT_VERSION + 1))).toThrow(
      /unsupported manifest version/,
    );
  });

  it('throws on a duplicate guid', () => {
    expect(() =>
      parseAssetManifest(file([entry('dup', 'a.mesh', 'Mesh'), entry('dup', 'b.mesh', 'Mesh')])),
    ).toThrow(/duplicate GUID/);
  });

  it('throws when an entry is missing a required field', () => {
    const text = JSON.stringify({
      version: MANIFEST_FORMAT_VERSION,
      entries: [{ guid: 'g', location: 'a.mesh' }],
    });
    expect(() => parseAssetManifest(text)).toThrow(/string `guid`, `location`, and `kind`/);
  });

  it('throws when entries is not an array', () => {
    const text = JSON.stringify({ version: MANIFEST_FORMAT_VERSION, entries: {} });
    expect(() => parseAssetManifest(text)).toThrow(/`entries` must be an array/);
  });
});
