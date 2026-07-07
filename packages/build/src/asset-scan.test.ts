import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseMetaEntry, scanProjectAssets } from './asset-scan';

const meta = (guid: string, kind: string): Uint8Array =>
  new TextEncoder().encode(JSON.stringify({ version: 1, guid, kind }));

describe('parseMetaEntry', () => {
  it('strips the .meta suffix for the asset location', () => {
    const e = parseMetaEntry('assets/hero.png.meta', meta('g1', 'Image'));
    expect(e.guid as string).toBe('g1');
    expect(e.location).toBe('assets/hero.png');
    expect(e.kind).toBe('Image');
  });

  it('bakes import settings (beyond version/guid/kind) into `meta`, else omits it', () => {
    const withSettings = new TextEncoder().encode(
      JSON.stringify({ version: 1, guid: 'g1', kind: 'Image', filter: 'nearest', colorSpace: 'linear' }),
    );
    const e = parseMetaEntry('assets/pixel.png.meta', withSettings);
    expect(e.meta).toEqual({ filter: 'nearest', colorSpace: 'linear' });
    // A sidecar with only version/guid/kind carries no import settings → no meta.
    expect(parseMetaEntry('assets/hero.png.meta', meta('g2', 'Image')).meta).toBeUndefined();
  });

  it('throws on non-object JSON', () => {
    expect(() => parseMetaEntry('x.meta', new TextEncoder().encode('42'))).toThrow(/not a JSON object/);
  });

  it('throws when guid/kind are missing', () => {
    expect(() => parseMetaEntry('x.meta', new TextEncoder().encode('{"guid":"g"}'))).toThrow(/guid.*kind/);
  });
});

describe('scanProjectAssets', () => {
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'asset-scan-'));
    await mkdir(join(root, 'assets'), { recursive: true });
    await writeFile(join(root, 'assets', 'hero.png'), new Uint8Array([1, 2, 3, 4]));
    await writeFile(join(root, 'assets', 'hero.png.meta'), meta('guid-hero', 'Image'));
    // Orphan sidecar (no asset file) → skipped.
    await writeFile(join(root, 'assets', 'ghost.png.meta'), meta('guid-ghost', 'Image'));
    // Excluded directory → not scanned.
    await mkdir(join(root, 'node_modules', 'pkg'), { recursive: true });
    await writeFile(join(root, 'node_modules', 'pkg', 'x.png'), new Uint8Array([9]));
    await writeFile(join(root, 'node_modules', 'pkg', 'x.png.meta'), meta('guid-dep', 'Image'));
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('builds a manifest + packable inputs from .meta sidecars, skipping orphans and excluded dirs', async () => {
    const { manifest, inputs } = await scanProjectAssets(root);

    expect(
      manifest.entries.map((e) => ({ guid: e.guid as string, location: e.location, kind: e.kind })),
    ).toEqual([{ guid: 'guid-hero', location: 'assets/hero.png', kind: 'Image' }]);
    expect(inputs).toHaveLength(1);
    expect(inputs[0]!.guid as string).toBe('guid-hero');
    expect(Array.from(inputs[0]!.data)).toEqual([1, 2, 3, 4]);
  });
});
