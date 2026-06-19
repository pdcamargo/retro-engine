import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import * as engine from '@retro-engine/engine';
import { App, AppTypeRegistry, RunCondition } from '@retro-engine/engine';
import { createWebGPURenderer } from '@retro-engine/renderer-webgpu';

import { publishHost } from '../host-bridge';
import { buildProject } from './build-project';
import { applyProject, loadEditorExtensions, loadProjectModule } from './load-project';
import type { InspectorRegistry } from '@retro-engine/editor-sdk';
import type { ProjectDefinition } from '@retro-engine/project';

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

  test('builds + loads an editor-extensions entry and runs its setup', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'retro-edit-'));
    try {
      writeFileSync(
        join(dir, 'editor.ts'),
        `
          import { defineEditorExtensions } from '@retro-engine/project/editor';
          export default defineEditorExtensions({
            setup(registry) { registry.registerComponentEditor('Health', {}); },
          });
        `,
      );
      const { code } = await buildProject({ entrypoint: join(dir, 'editor.ts') });
      const outFile = join(dir, 'editor.built.mjs');
      writeFileSync(outFile, code);

      const ext = await loadEditorExtensions(outFile);
      const registered: string[] = [];
      const stub = {
        registerComponentEditor: (key: string) => registered.push(key),
      } as unknown as InspectorRegistry;
      ext.setup(stub);
      expect(registered).toEqual(['Health']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('gates project systems behind the play condition, except startup', () => {
    const recorded: { stage: string; runIf: unknown }[] = [];
    const stub = {
      addSystem: (stage: string, _p: unknown, _f: unknown, options?: { runIf?: unknown }) => {
        recorded.push({ stage, runIf: options?.runIf });
      },
      addPlugins: (plugins: { build(app: unknown): void }[]) => {
        for (const p of plugins) p.build(stub);
      },
    };
    const project = {
      plugins: [
        {
          name: () => 'P',
          build: (app: App) => {
            app.addSystem('update', [], () => {}, { name: 'u' });
            app.addSystem('startup', [], () => {}, { name: 's' });
          },
        },
      ],
    } as unknown as ProjectDefinition;

    const gate = new RunCondition(() => true);
    applyProject(stub as unknown as App, project, gate);

    expect(recorded.find((r) => r.stage === 'update')?.runIf).toBe(gate);
    expect(recorded.find((r) => r.stage === 'startup')?.runIf).toBeUndefined();
  });
});
