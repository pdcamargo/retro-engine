import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import * as engine from '@retro-engine/engine';
import { App, AppTypeRegistry } from '@retro-engine/engine';
import { createWebGPURenderer } from '@retro-engine/renderer-webgpu';

import { publishHost } from '../host-bridge';
import { buildProject } from './build-project';
import { applyProject, loadProjectModule } from './load-project';

// Publish the studio's live engine packages so built user code resolves to them.
publishHost();

const FIXTURE = `
  import { defineProject } from '@retro-engine/project';
  import { Transform } from '@retro-engine/engine';
  class DemoPlugin {
    name() { return 'DemoPlugin'; }
    build() {}
  }
  export const usedTransform = Transform;
  export default defineProject({ plugins: [new DemoPlugin()], meta: { name: 'Demo' } });
`;

describe('project loader', () => {
  test('builds user code, resolves @retro-engine/* to the host, default-exports the project', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'retro-proj-'));
    try {
      writeFileSync(join(dir, 'game.ts'), FIXTURE);

      const { code } = await buildProject({ entrypoint: join(dir, 'game.ts') });
      // The engine import was rewritten to the host global, not bundled.
      expect(code).toContain('__retroHost');

      const outFile = join(dir, 'game.built.mjs');
      writeFileSync(outFile, code);
      const mod = (await import(outFile)) as {
        default: { plugins: { name(): string }[]; meta?: { name?: string } };
        usedTransform: unknown;
      };

      expect(mod.default.meta?.name).toBe('Demo');
      expect(mod.default.plugins[0]!.name()).toBe('DemoPlugin');
      // Shared-instance proof: the built code's Transform IS the studio's Transform.
      expect(mod.usedTransform).toBe(engine.Transform);

      const def = await loadProjectModule(outFile);
      expect(def.plugins.length).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('applying a built project registers its components into a fresh App (App-rebuild path)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'retro-proj-'));
    try {
      writeFileSync(
        join(dir, 'game.ts'),
        `
          import { defineProject } from '@retro-engine/project';
          import { t } from '@retro-engine/reflect';
          class Mana { amount = 50; }
          class ManaPlugin {
            name() { return 'ManaPlugin'; }
            build(app) { app.registerComponent(Mana, { amount: t.number }); }
          }
          export default defineProject({ plugins: [new ManaPlugin()] });
        `,
      );
      const { code } = await buildProject({ entrypoint: join(dir, 'game.ts') });
      const outFile = join(dir, 'game.built.mjs');
      writeFileSync(outFile, code);
      const project = await loadProjectModule(outFile);

      // A fresh App is in its Building phase, so addPlugins (via applyProject) runs.
      const app = new App({ renderer: createWebGPURenderer({} as HTMLCanvasElement) });
      applyProject(app, project);

      // The project's plugin registered its component (name defaults to ctor.name).
      const registry = app.getResource(AppTypeRegistry)!.registry;
      const mana = registry.get('Mana');
      expect(mana).toBeDefined();
      expect(mana!.attachable).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
