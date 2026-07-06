import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runWebExport } from './run-export';

let root: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'retro-build-cli-'));
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(
    join(root, 'project.retroengine'),
    `formatVersion = 2
projectId = "test-id"

[project]
name = "CLI Test Game"
version = "0.1.0"

[build]
entry = "src/game.ts"
`,
  );
  await writeFile(join(root, 'src', 'game.ts'), 'export default { plugins: [] };\n');
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('runWebExport', () => {
  it('reads the descriptor, exports to the default outDir, and titles the page from the project name', async () => {
    const result = await runWebExport({ projectRoot: root, external: ['@retro-engine/runtime-web'] });

    expect(result.descriptor.name).toBe('CLI Test Game');
    expect(result.outDir).toBe(join(root, 'dist', 'web'));

    const names = result.outputs.map((p) => p.split('/').pop());
    expect(names).toContain('index.html');
    expect(names).toContain('main.js');

    const html = await readFile(join(result.outDir, 'index.html'), 'utf8');
    expect(html).toContain('<title>CLI Test Game</title>');
  });

  it('throws a clear error when there is no project.retroengine', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'retro-build-empty-'));
    await expect(runWebExport({ projectRoot: empty })).rejects.toThrow(/no project\.retroengine/);
    await rm(empty, { recursive: true, force: true });
  });

  it('throws when the build entry is missing', async () => {
    const bad = await mkdtemp(join(tmpdir(), 'retro-build-bad-'));
    await writeFile(join(bad, 'project.retroengine'), '[build]\nentry = "src/missing.ts"\n');
    await expect(runWebExport({ projectRoot: bad })).rejects.toThrow(/build entry .* not found/);
    await rm(bad, { recursive: true, force: true });
  });
});
