import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { RpakReader } from './rpak-reader';
import { bundleUserCode } from './web-bundle';
import { WebExportTarget } from './web-export-target';

let root: string;
// Entry for the bundleUserCode test: imports an external so the bundle stays tiny.
let bundleEntry: string;
// Entry for the WebExportTarget tests: default-exports a ProjectDefinition.
let gameEntry: string;

// The generated boot entry imports `@retro-engine/runtime-web`; externalizing it
// keeps the export bundle from pulling the whole engine graph into the test.
const RUNTIME_EXTERNAL = '@retro-engine/runtime-web';

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'rpak-web-export-'));
  const src = join(root, 'src');
  await mkdir(src, { recursive: true });

  bundleEntry = join(src, 'main.ts');
  await writeFile(
    bundleEntry,
    "import { boot } from 'fake-engine';\nboot(document.getElementById('game'));\nexport const ready = true;\n",
  );

  gameEntry = join(src, 'game.ts');
  await writeFile(gameEntry, 'export default { plugins: [] };\n');
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('bundleUserCode', () => {
  it('bundles a browser ESM entry, leaving externals as bare imports', async () => {
    const result = await bundleUserCode({
      entrypoints: [bundleEntry],
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
  it('emits index.html, a boot bundle that calls bootWebGame, and a readable .rpak', async () => {
    const outDir = join(root, 'dist');
    const target = new WebExportTarget({
      entrypoint: gameEntry,
      external: [RUNTIME_EXTERNAL],
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

    // The bundle boots the game through the runtime host (kept external here).
    const mainJs = await readFile(join(outDir, 'main.js'), 'utf8');
    expect(mainJs).toContain('bootWebGame');
    expect(mainJs).toContain(RUNTIME_EXTERNAL);

    // The temp boot entry is cleaned up.
    expect(names).not.toContain('.retro-web-boot-entry.ts');

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
    const target = new WebExportTarget({ entrypoint: gameEntry, external: [RUNTIME_EXTERNAL] });
    const result = await target.export({ projectRoot: root, outDir, production: false });
    expect(result.outputs.some((p) => p.endsWith('.rpak'))).toBe(false);
    const html = await readFile(join(outDir, 'index.html'), 'utf8');
    expect(html).not.toContain('rel="preload"');
  });
});
