import { describe, expect, it } from 'bun:test';

import type { AssetGuid, AssetManifest, AssetSource, Handle } from '@retro-engine/assets';
import { Assets } from '@retro-engine/assets';
import { t, TypeRegistry } from '@retro-engine/reflect';

import { AssetServer } from '../asset/asset-server';
import type { SceneData } from './scene-data';
import { collectSceneHandleRefs, unloadUnusedAssets } from './scene-streaming';

class Spriteish {
  image: Handle<unknown> | undefined = undefined;
}
class Config {
  atlas: Handle<unknown> | undefined = undefined;
}

const registry = (): TypeRegistry => {
  const reg = new TypeRegistry();
  reg.registerComponent(Spriteish, { image: t.handle<unknown>('Image').optional() });
  reg.registerComponent(Config, { atlas: t.handle<unknown>('Image').optional() });
  return reg;
};

const sceneWith = (imageGuid: string, opts: { child?: string } = {}): SceneData => ({
  version: 1,
  entities: [
    {
      id: 0,
      components: [{ type: 'Spriteish', version: 1, data: { image: imageGuid } }],
      ...(opts.child !== undefined ? { scene: { guid: opts.child } } : {}),
    },
  ],
});

describe('collectSceneHandleRefs', () => {
  it('collects component, resource, and nested-scene refs, de-duplicated', () => {
    const reg = registry();
    const scene: SceneData = {
      version: 1,
      entities: [
        { id: 0, components: [{ type: 'Spriteish', version: 1, data: { image: 'img-a' } }] },
        {
          id: 1,
          components: [{ type: 'Spriteish', version: 1, data: { image: 'img-a' } }],
          scene: { guid: 'child-scene' },
        },
      ],
      resources: [{ type: 'Config', version: 1, data: { atlas: 'img-b' } }],
    };
    const refs = collectSceneHandleRefs(reg, scene);
    expect(refs.map((r) => `${r.assetType}:${r.guid}`).sort()).toEqual([
      'Image:img-a',
      'Image:img-b',
      'Scene:child-scene',
    ]);
  });

  it('ignores unregistered component types', () => {
    const reg = registry();
    const scene: SceneData = {
      version: 1,
      entities: [{ id: 0, components: [{ type: 'Unknown', version: 1, data: { image: 'x' } }] }],
    };
    expect(collectSceneHandleRefs(reg, scene)).toEqual([]);
  });
});

const manifest = (entries: Record<string, string>): AssetManifest => ({
  entries: new Map(
    Object.entries(entries).map(([guid, location]) => [
      guid as AssetGuid,
      { guid: guid as AssetGuid, location, kind: 'X' },
    ]),
  ),
});

const stubServer = (): { server: AssetServer; store: Assets<string> } => {
  const source: AssetSource = { read: () => Promise.resolve(new TextEncoder().encode('x')) };
  const server = new AssetServer({ source });
  const store = new Assets<string>();
  server.registerLoader('asset', store, () => 'loaded');
  server.setManifest(manifest({ g1: 'a/1.asset', g2: 'a/2.asset' }));
  return { server, store };
};

const drain = (server: AssetServer): void => {
  for (const { store, handle, value } of server.drainCompleted()) store.insert(handle, value);
};

describe('AssetServer.unloadByGuid', () => {
  it('removes a loaded asset and lets a later load re-read it', async () => {
    const { server, store } = stubServer();
    server.loadByGuid('g1' as AssetGuid);
    await server.settle();
    drain(server);
    expect(store.size).toBe(1);

    server.unloadByGuid('g1' as AssetGuid);
    expect(store.size).toBe(0);

    // A fresh load re-reserves and re-reads (idempotency was cleared).
    server.loadByGuid('g1' as AssetGuid);
    await server.settle();
    drain(server);
    expect(store.size).toBe(1);
  });

  it('is a no-op for a never-loaded GUID', () => {
    const { server } = stubServer();
    expect(() => server.unloadByGuid('never' as AssetGuid)).not.toThrow();
  });
});

describe('unloadUnusedAssets (scene swap)', () => {
  it('releases the outgoing-only asset and keeps the shared one', async () => {
    const reg = new TypeRegistry();
    reg.registerComponent(Spriteish, { image: t.handle<unknown>('Image').optional() });

    const source: AssetSource = { read: () => Promise.resolve(new TextEncoder().encode('x')) };
    const server = new AssetServer({ source });
    const store = new Assets<string>();
    server.registerLoader('asset', store, () => 'loaded');
    server.setManifest(manifest({ shared: 'a/s.asset', old: 'a/o.asset' }));

    // Outgoing scene referenced both `shared` and `old`; load them.
    server.loadByGuid('shared' as AssetGuid);
    server.loadByGuid('old' as AssetGuid);
    await server.settle();
    drain(server);
    expect(store.size).toBe(2);

    const outgoing: SceneData = {
      version: 1,
      entities: [
        { id: 0, components: [{ type: 'Spriteish', version: 1, data: { image: 'old' } }] },
        { id: 1, components: [{ type: 'Spriteish', version: 1, data: { image: 'shared' } }] },
      ],
    };
    const incoming = sceneWith('shared');

    unloadUnusedAssets(server, reg, outgoing, incoming);

    // `old` is gone (outgoing-only); `shared` stays (incoming still references it).
    expect(store.size).toBe(1);
    expect(server.hasGuid('shared' as AssetGuid)).toBe(true);
    expect(server.hasGuid('old' as AssetGuid)).toBe(true); // still in the manifest
  });
});
