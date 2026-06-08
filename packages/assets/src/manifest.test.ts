import { describe, expect, it } from 'bun:test';

import type { AssetGuid } from './asset-id';
import type { AssetManifestEntry } from './manifest';
import {
  MANIFEST_FORMAT_VERSION,
  bakeManifest,
  parseAssetManifest,
  serializeAssetManifest,
} from './manifest';

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

describe('bakeManifest / serializeAssetManifest — inverse of parseAssetManifest', () => {
  const baked = (guid: string, location: string, kind: string): AssetManifestEntry => ({
    guid: guid as AssetGuid,
    location,
    kind,
  });

  it('bake → serialize → parse reproduces the entry map', () => {
    const entries = [
      baked('11111111-1111-4111-8111-111111111111', 'assets/a.rmesh', 'Mesh'),
      baked('22222222-2222-4222-8222-222222222222', 'scenes/main.scene', 'Scene'),
    ];
    const fileObj = bakeManifest(entries);
    expect(fileObj.version).toBe(MANIFEST_FORMAT_VERSION);

    const parsed = parseAssetManifest(serializeAssetManifest(fileObj));
    expect(parsed.entries.size).toBe(2);
    expect(parsed.entries.get(entries[0]!.guid)).toEqual(entries[0]!);
    expect(parsed.entries.get(entries[1]!.guid)).toEqual(entries[1]!);
  });

  it('rejects duplicate GUIDs at bake time, mirroring parse', () => {
    const dup = '33333333-3333-4333-8333-333333333333';
    expect(() =>
      bakeManifest([baked(dup, 'a.rmesh', 'Mesh'), baked(dup, 'b.rmesh', 'Mesh')]),
    ).toThrow(/duplicate GUID/);
  });

  it('bakes an empty manifest', () => {
    const parsed = parseAssetManifest(serializeAssetManifest(bakeManifest([])));
    expect(parsed.entries.size).toBe(0);
  });
});
