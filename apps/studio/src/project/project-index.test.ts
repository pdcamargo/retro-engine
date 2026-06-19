import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { App, AppTypeRegistry, scanMetaManifest } from '@retro-engine/engine';
import { createWebGPURenderer } from '@retro-engine/renderer-webgpu';
import type { InspectorRegistry } from '@retro-engine/editor-sdk';

import { publishHost } from '../host-bridge';
import { buildProject } from './build-project';
import { applyProject, loadProjectModule } from './load-project';
import { buildCodeIndex, buildFileIndex, captureBaseline, parseProjectDescriptor } from './project-index';

publishHost();

const DESCRIPTOR = `
formatVersion = 2
projectId = "abc-123"

[project]
name = "Sample"
version = "0.2.0"
engine = "0.0.0"

[build]
entry = "src/game.ts"
editorEntry = "src/editor.ts"

[run]
startupScene = "scene-guid"
`;

const enc = (obj: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(obj));

describe('parseProjectDescriptor', () => {
  test('reads the descriptor tables', () => {
    const d = parseProjectDescriptor(DESCRIPTOR);
    expect(d.formatVersion).toBe(2);
    expect(d.projectId).toBe('abc-123');
    expect(d.name).toBe('Sample');
    expect(d.buildEntry).toBe('src/game.ts');
    expect(d.editorEntry).toBe('src/editor.ts');
    expect(d.startupScene).toBe('scene-guid');
  });
});

describe('buildFileIndex', () => {
  test('classifies scenes and prefabs from the scanned manifest', () => {
    const manifest = scanMetaManifest([
      ['levels/main.rescene.meta', enc({ version: 1, guid: 'g-scene', kind: 'Scene' })],
      ['prefabs/player.reprefab.meta', enc({ version: 1, guid: 'g-prefab', kind: 'Prefab' })],
      ['art/hero.png.meta', enc({ version: 1, guid: 'g-img', kind: 'Image' })],
    ]);
    const files = buildFileIndex(manifest);
    expect(files.scenes.map((s) => s.guid)).toEqual(['g-scene']);
    expect(files.prefabs.map((s) => s.guid)).toEqual(['g-prefab']);
    expect(files.assets.entries.size).toBe(3);
  });
});

describe('buildCodeIndex', () => {
  test('reports the project-registered components beyond the engine baseline', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'retro-idx-'));
    try {
      writeFileSync(
        join(dir, 'game.ts'),
        `
          import { defineProject } from '@retro-engine/project';
          import { t } from '@retro-engine/reflect';
          class Mana { amount = 50; }
          class ManaPlugin {
            name() { return 'ManaPlugin'; }
            build(app) {
              app.registerComponent(Mana, { amount: t.number });
              app.addSystem('update', [], () => {}, { name: 'mana-regen', origin: 'user' });
            }
          }
          export default defineProject({ plugins: [new ManaPlugin()] });
        `,
      );
      const { code } = await buildProject({ entrypoint: join(dir, 'game.ts') });
      const outFile = join(dir, 'game.built.mjs');
      writeFileSync(outFile, code);

      const app = new App({ renderer: createWebGPURenderer({} as HTMLCanvasElement) });
      const baseline = captureBaseline(app);
      applyProject(app, await loadProjectModule(outFile));

      const inspector = {
        describe: () => [{ component: 'Health', hasEditor: true, fieldRenderers: 0, amendments: 0 }],
      } as unknown as InspectorRegistry;

      const index = buildCodeIndex(app, inspector, baseline);
      expect(index.components).toContain('Mana');
      expect(app.getResource(AppTypeRegistry)!.registry.get('Mana')).toBeDefined();
      expect(index.editors).toEqual(['Health']);
      expect(index.systems.some((s) => s.name === 'mana-regen')).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
