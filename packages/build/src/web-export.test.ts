import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { RpakReader } from './rpak-reader';
import { bundleUserCode } from './web-bundle';
import { WebExportTarget } from './web-export-target';

let root: string;
let entrypoint: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'rpak-web-export-'));
  const src = join(root, 'src');
  await mkdir(src, { recursive: true });
  entrypoint = join(src, 'main.ts');
  // Imports an external so the bundle stays tiny + the test never pulls a real
  // dependency graph — the wrapper's job is what's under test, not what it bundles.
  await writeFile(
    entrypoint,
    "import { boot } from 'fake-engine';\nboot(document.getElementById('game'));\nexport const ready = true;\n",
  );
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('bundleUserCode', () => {
  it('bundles a browser ESM entry, leaving externals as bare imports', async () => {
    const result = await bundleUserCode({
      entrypoints: [entrypoint],
      external: ['fake-engine'],
      target: 'browser',
    });
    expect(result.success).toBe(true);
    const entry = result.artifacts.find((a) => a.kind === 'entry-point');
    expect(entry).toBeDefined();
    expect(await entry!.text()).toContain('fake-engine'); // external kept, not inlined
  });
});

describe('WebExportTarget', () => {
  it('emits index.html, the entry bundle, and a .rpak the reader can read back', async () => {
    const outDir = join(root, 'dist');
    const target = new WebExportTarget({
      entrypoint,
      external: ['fake-engine'],
      title: 'My Game',
      assets: [
        { guid: 'asset-1', data: new TextEncoder().encode('level-one') },
        { guid: 'asset-2', data: new TextEncoder().encode('sprite-bytes'), codec: 'gzip' },
      ],
    });

    const result = await target.export({ projectRoot: root, outDir, production: false });

    const names = result.outputs.map((p) => p.split('/').pop());
    expect(names).toContain('index.html');
    expect(names).toContain('main.js');
    expect(names).toContain('assets.rpak');

    const html = await readFile(join(outDir, 'index.html'), 'utf8');
    expect(html).toContain('src="main.js"');
    expect(html).toContain('href="assets.rpak"');
    expect(html).toContain('<title>My Game</title>');

    const rpak = new RpakReader(new Uint8Array(await readFile(join(outDir, 'assets.rpak'))));
    expect(rpak.guids.sort()).toEqual(['asset-1', 'asset-2']);
    expect(new TextDecoder().decode(await rpak.read('asset-1'))).toBe('level-one');
    expect(new TextDecoder().decode(await rpak.read('asset-2'))).toBe('sprite-bytes');
  });

  it('skips the .rpak when there are no assets', async () => {
    const outDir = join(root, 'dist-noassets');
    const target = new WebExportTarget({ entrypoint, external: ['fake-engine'] });
    const result = await target.export({ projectRoot: root, outDir, production: false });
    expect(result.outputs.some((p) => p.endsWith('.rpak'))).toBe(false);
    const html = await readFile(join(outDir, 'index.html'), 'utf8');
    expect(html).not.toContain('rel="preload"');
  });
});
