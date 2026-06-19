import { describe, expect, test } from 'bun:test';

import { App, MemoryAssetSource, Name } from '@retro-engine/engine';
import { createWebGPURenderer } from '@retro-engine/renderer-webgpu';
import { t } from '@retro-engine/reflect';

import { loadProjectScene, scanProjectManifest } from './project-scene';

const SCENE_GUID = 'f1a2b3c4-d5e6-4789-8abc-0123456789ab';
const SCENE_YAML = `version: 1
entities:
  - id: 0
    components:
      - { type: Name, version: 1, data: { value: Hero } }
      - { type: Health, version: 1, data: { current: 100, max: 100 } }
`;
const META = JSON.stringify({ version: 1, guid: SCENE_GUID, kind: 'Scene' });
const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

class Health {
  current = 0;
  max = 0;
}

describe('project scene loading', () => {
  test('scans .meta, loads the startup scene by GUID, and spawns it', async () => {
    const app = new App({ renderer: createWebGPURenderer({} as HTMLCanvasElement) });
    // The scene references Health, which the project's plugin would have registered.
    app.registerComponent(Health, { current: t.number, max: t.number });

    const source = new MemoryAssetSource(
      new Map([
        ['assets/scenes/main.rescene', enc(SCENE_YAML)],
        ['assets/scenes/main.rescene.meta', enc(META)],
      ]),
    );
    const files = ['assets/scenes/main.rescene', 'assets/scenes/main.rescene.meta'];

    const manifest = await scanProjectManifest(source, files);
    expect(manifest.entries.get(SCENE_GUID as never)?.location).toBe('assets/scenes/main.rescene');

    const ok = await loadProjectScene(app, source, manifest, SCENE_GUID);
    expect(ok).toBe(true);

    const heroes = [...app.world.entities()]
      .map((e) => app.world.getComponent(e, Name))
      .filter((n): n is Name => n !== undefined && n.value === 'Hero');
    expect(heroes.length).toBe(1);
  });
});
