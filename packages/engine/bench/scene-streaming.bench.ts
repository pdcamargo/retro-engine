// Scene-aware asset streaming: handle-ref scan + swap-diff cost (ADR-0100).
//
// The selective-load path replaces a bulk manifest preload with "load only what
// a scene references". The discovery step is `collectSceneHandleRefs`, a reflect
// walk over a scene's serialized data — a content-scaling algorithm (CLAUDE.md
// §11), so it gets a bench. This proves the scan cost scales with the *scene's*
// reference count, not the *project's* asset count: the `scan` arms vary the
// scene's K refs while the manifest size is irrelevant to the walk. The
// `swap-diff` arm measures `unloadUnusedAssets`, the set-diff a scene swap runs
// to release the outgoing-only assets (no IO — the store removals are no-ops on
// a fresh stub, so this is the pure diff cost).
//
// See docs/adr/ADR-0017 (bench schema).

import { bench, summary } from 'mitata';

import type { AssetGuid, AssetManifest, AssetSource, Handle } from '@retro-engine/assets';
import { t, TypeRegistry } from '@retro-engine/reflect';

import { AssetServer } from '../src/asset/asset-server';
import type { SceneData } from '../src/scene/scene-data';
import { collectSceneHandleRefs, unloadUnusedAssets } from '../src/scene/scene-streaming';

class Renderable {
  mesh: Handle<unknown> | undefined = undefined;
  texture: Handle<unknown> | undefined = undefined;
}

const registry = (): TypeRegistry => {
  const reg = new TypeRegistry();
  reg.registerComponent(Renderable, {
    mesh: t.handle<unknown>('Mesh').optional(),
    texture: t.handle<unknown>('Image').optional(),
  });
  return reg;
};

// A scene of `entities` entities, each referencing two distinct assets.
const sceneOf = (entities: number, prefix = 'a'): SceneData => ({
  version: 1,
  entities: Array.from({ length: entities }, (_, i) => ({
    id: i,
    components: [
      { type: 'Renderable', version: 1, data: { mesh: `${prefix}-mesh-${i}`, texture: `${prefix}-tex-${i}` } },
    ],
  })),
});

const reg = registry();

summary(() => {
  for (const k of [8, 64, 512]) {
    const scene = sceneOf(k);
    bench(`scan scene refs (K=${k})`, () => {
      collectSceneHandleRefs(reg, scene);
    }).gc('inner');
  }
});

const source: AssetSource = { read: () => Promise.resolve(new Uint8Array()) };
const swapServer = (): AssetServer => {
  const server = new AssetServer({ source });
  const manifest: AssetManifest = { entries: new Map<AssetGuid, never>() };
  server.setManifest(manifest);
  return server;
};

summary(() => {
  for (const k of [8, 64, 512]) {
    const outgoing = sceneOf(k, 'old');
    const incoming = sceneOf(k, 'new'); // fully disjoint → every outgoing ref released
    const server = swapServer();
    bench(`swap-diff (K=${k})`, () => {
      unloadUnusedAssets(server, reg, outgoing, incoming);
    }).gc('inner');
  }
});
