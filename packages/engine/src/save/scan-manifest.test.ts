import { describe, expect, it } from 'bun:test';

import { scanMetaManifest, type ProjectFile } from './scan-manifest';

const enc = (obj: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(obj));

describe('scanMetaManifest', () => {
  it('rebuilds entries from .meta sidecars, stripping the suffix for the location', () => {
    const files: ProjectFile[] = [
      ['scenes/main.rescene', new Uint8Array()],
      ['scenes/main.rescene.meta', enc({ version: 1, guid: 'g-scene', kind: 'Scene' })],
      ['assets/abc.rmesh', new Uint8Array()],
      ['assets/abc.rmesh.meta', enc({ version: 1, guid: 'g-mesh', kind: 'Mesh' })],
    ];
    const manifest = scanMetaManifest(files);
    expect(manifest.entries.size).toBe(2);
    expect(manifest.entries.get('g-scene' as never)).toEqual({
      guid: 'g-scene',
      location: 'scenes/main.rescene',
      kind: 'Scene',
    } as never);
    expect(manifest.entries.get('g-mesh' as never)?.location).toBe('assets/abc.rmesh');
  });

  it('ignores non-.meta files', () => {
    const manifest = scanMetaManifest([['a.rescene', new Uint8Array()]]);
    expect(manifest.entries.size).toBe(0);
  });

  it('throws on a duplicate GUID across sidecars', () => {
    const files: ProjectFile[] = [
      ['a.rmesh.meta', enc({ version: 1, guid: 'dup', kind: 'Mesh' })],
      ['b.rmesh.meta', enc({ version: 1, guid: 'dup', kind: 'Mesh' })],
    ];
    expect(() => scanMetaManifest(files)).toThrow(/duplicate GUID/);
  });

  it('throws on a malformed sidecar', () => {
    expect(() => scanMetaManifest([['x.meta', enc({ version: 1 })]])).toThrow(/guid.*kind/);
  });
});
