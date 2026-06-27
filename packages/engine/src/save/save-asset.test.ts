import { describe, expect, it } from 'bun:test';
import { type AssetManifest, generateAssetGuid } from '@retro-engine/assets';
import { vec4 } from '@retro-engine/math';

import {
  App,
  AssetPlugin,
  AssetServer,
  applyCompletedLoads,
  createMaterialSerializer,
  Light3dPlugin,
  MaterialPlugin,
  registerMaterialLoaders,
  saveAsset,
  StandardMaterial,
  StandardMaterialPlugin,
} from '../index';
import { MemoryAssetSink, MemoryAssetSource } from '../asset/memory-sink';
import { makeCapturingRenderer, makeStubCanvas } from '../test-utils';

const buildApp = (source: MemoryAssetSource) => {
  const { renderer } = makeCapturingRenderer();
  const app = new App({ renderer, canvas: makeStubCanvas() });
  app.addPlugin(new StandardMaterialPlugin());
  app.addPlugin(new MaterialPlugin(StandardMaterial));
  app.addPlugin(new Light3dPlugin());
  app.addPlugin(new AssetPlugin({ source }));
  return app;
};

describe('saveAsset', () => {
  it('serializes an edited material back to its file', async () => {
    // Seed a .remat on disk, load it, edit it, then save it back.
    const seed = createMaterialSerializer<StandardMaterial>(
      buildApp(new MemoryAssetSource(new Map())),
      StandardMaterial,
    ).serialize(new StandardMaterial({ baseColor: vec4.create(0.9, 0.1, 0.1, 1), metallic: 1, roughness: 0.2 }));

    const guid = generateAssetGuid();
    const source = new MemoryAssetSource(new Map([['mat.remat', seed]]));
    const app = buildApp(source);
    const server = app.getResource(AssetServer)!;
    const manifest: AssetManifest = {
      entries: new Map([[guid, { guid, location: 'mat.remat', kind: 'StandardMaterial' }]]),
    };
    server.setManifest(manifest);
    registerMaterialLoaders(app);

    const handle = server.loadByGuid<StandardMaterial>(guid);
    await server.settle();
    applyCompletedLoads(server);

    // Edit the live material (as an inspector edit would, via the store).
    const stores = app.getResource(AssetServer)!.storeForGuid(guid)!;
    (stores.store.getMut(handle) as StandardMaterial).roughness = 0.85;

    const sink = new MemoryAssetSink();
    const ok = await saveAsset(app, guid, 'StandardMaterial', 'mat.remat', sink);
    expect(ok).toBe(true);

    // The written bytes carry the edit.
    const written = sink.files.get('mat.remat')!;
    const restored = createMaterialSerializer<StandardMaterial>(app, StandardMaterial).deserialize(written);
    expect(restored.roughness).toBeCloseTo(0.85, 5);
    expect(Array.from(restored.baseColor)[0]).toBeCloseTo(0.9, 5);
  });

  it('returns false for an unknown kind', async () => {
    const app = buildApp(new MemoryAssetSource(new Map()));
    const ok = await saveAsset(app, generateAssetGuid(), 'NopeKind', 'x.remat', new MemoryAssetSink());
    expect(ok).toBe(false);
  });
});
