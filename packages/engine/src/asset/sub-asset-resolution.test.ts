import { describe, expect, it } from 'bun:test';

import type { AssetGuid, AssetManifest, AssetSource, LoadContext } from '@retro-engine/assets';
import { Assets, subAssetGuid } from '@retro-engine/assets';

import { AssetServer } from './asset-server';
import { applyCompletedLoads } from './load-drain';

class Clip {
  constructor(public readonly name: string) {}
}

class Model {
  constructor(public readonly clips: readonly { index: number }[]) {}
}

const PARENT = '11111111-1111-4111-8111-111111111111' as AssetGuid;

const sourceFrom = (entries: Record<string, string>): AssetSource => ({
  read: (location) =>
    entries[location] === undefined
      ? Promise.reject(new Error(`missing: ${location}`))
      : Promise.resolve(new TextEncoder().encode(entries[location]!)),
});

const manifestOf = (guid: AssetGuid, location: string, kind: string): AssetManifest => ({
  entries: new Map([[guid, { guid, location, kind }]]),
});

const makeServer = (): { server: AssetServer; clips: Assets<Clip> } => {
  const clips = new Assets<Clip>();
  const models = new Assets<Model>();
  // A model importer that registers two labeled clips, mirroring the glTF path.
  const importModel = (_bytes: Uint8Array, ctx: LoadContext): Model => {
    const a = ctx.addLabeledAsset('Animation0', new Clip('Idle'), clips);
    const b = ctx.addLabeledAsset('Animation1', new Clip('Run'), clips);
    return new Model([a, b]);
  };
  const server = new AssetServer({ source: sourceFrom({ 'hero.model': 'root' }) });
  server.registerLoader('model', models, importModel);
  server.registerSubAssetStore('Animation', clips);
  server.setManifest(manifestOf(PARENT, 'hero.model', 'Model'));
  return { server, clips };
};

describe('sub-asset reference resolution', () => {
  it('resolves a sub-ref after the parent has loaded', async () => {
    const { server, clips } = makeServer();
    server.loadByGuid<Model>(PARENT);
    await server.settle();
    applyCompletedLoads(server);

    const handle = server.loadByGuid<Clip>(subAssetGuid(PARENT, 'Animation0'));
    expect(clips.get(handle)?.name).toBe('Idle');
  });

  it('returns a stable handle for a sub-ref requested before the parent loads', async () => {
    const { server, clips } = makeServer();
    // The hard case: the sub-ref is requested first (as a scene load would),
    // so loadByGuid must hand back a slot now and have the parent's
    // addLabeledAsset fill *that* slot when its IO completes.
    const handle = server.loadByGuid<Clip>(subAssetGuid(PARENT, 'Animation1'));
    expect(clips.get(handle)).toBeUndefined();

    await server.settle();
    applyCompletedLoads(server);

    expect(clips.get(handle)?.name).toBe('Run');
  });

  it('is idempotent — the same sub-ref returns the same handle', async () => {
    const { server, clips } = makeServer();
    const ref = subAssetGuid(PARENT, 'Animation0');
    const first = server.loadByGuid<Clip>(ref);
    const second = server.loadByGuid<Clip>(ref);
    expect(second.index).toBe(first.index);

    await server.settle();
    applyCompletedLoads(server);
    const third = server.loadByGuid<Clip>(ref);
    expect(third.index).toBe(first.index);
    expect(clips.get(third)?.name).toBe('Idle');
  });

  it('hasGuid recognizes a sub-ref whose container is in the manifest', () => {
    const { server } = makeServer();
    expect(server.hasGuid(subAssetGuid(PARENT, 'Animation0'))).toBe(true);
    expect(server.hasGuid('99999999-9999-4999-8999-999999999999#Animation0' as AssetGuid)).toBe(
      false,
    );
  });

  it('throws for a sub-ref whose label has no registered store', () => {
    const { server } = makeServer();
    expect(() => server.loadByGuid(subAssetGuid(PARENT, 'Mesh0'))).toThrow(/no sub-asset store/);
  });
});
