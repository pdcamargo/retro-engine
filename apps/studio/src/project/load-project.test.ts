import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import * as engine from '@retro-engine/engine';

import { publishHost } from '../host-bridge';
import { buildProject } from './build-project';
import { loadProjectModule } from './load-project';

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
});
