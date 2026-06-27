import { describe, expect, it } from 'bun:test';

import type { AssetGuid, AssetManifest, AssetSource, LoadContext } from '@retro-engine/assets';
import { Assets, subAssetGuid } from '@retro-engine/assets';

import { AssetPlugin } from '../asset/asset-plugin';
import { AssetServer } from '../asset/asset-server';
import { applyCompletedLoads } from '../asset/load-drain';
import { App } from '../index';
import { makeHeadlessRenderer } from '../test-utils';

import { AnimationClip } from './animation-clip';
import { AnimationClips } from './animation-clip-asset';

const PARENT = '11111111-1111-4111-8111-111111111111' as AssetGuid;

const sourceFrom = (entries: Record<string, string>): AssetSource => ({
  read: (location) =>
    entries[location] === undefined
      ? Promise.reject(new Error(`missing: ${location}`))
      : Promise.resolve(new TextEncoder().encode(entries[location]!)),
});

describe('AnimationPlugin asset-server registration', () => {
  // CorePlugin (added in the App constructor) adds AnimationPlugin, so an
  // AnimationPlugin always builds before any AssetPlugin. Its standalone loaders
  // and the Animation sub-asset store must still register once the server exists.
  it('registers the standalone loaders even though AnimationPlugin builds before the AssetServer', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    // No AssetServer yet — AnimationPlugin has already built at this point.
    expect(app.getResource(AssetServer)).toBeUndefined();

    app.addPlugin(new AssetPlugin({ source: sourceFrom({}) }));
    const server = app.getResource(AssetServer)!;

    // All three standalone loaders resolved (kicking IO is fine — the stub
    // source's rejection is captured off-schedule, not thrown here).
    expect(() => server.load('idle.ranim')).not.toThrow();
    expect(() => server.load('locomotion.ranimctrl')).not.toThrow();
    expect(() => server.load('upper-body.ramask')).not.toThrow();
    // Control: an unregistered extension still throws synchronously.
    expect(() => server.load('thing.zzz')).toThrow(/no loader/);
  });

  it('registers the Animation sub-asset store so a model clip ref resolves into AnimationClips', async () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    app.addPlugin(new AssetPlugin({ source: sourceFrom({ 'hero.glbstub': 'root' }) }));
    const server = app.getResource(AssetServer)!;
    const clips = app.getResource(AnimationClips)!;

    // A stand-in parent loader that emits a labeled clip, mirroring the glTF
    // importer. It must target the very AnimationClips store AnimationPlugin
    // registered as the 'Animation' sub-asset store, so reuse the resource.
    const parents = new Assets<object>();
    const importParent = (_bytes: Uint8Array, ctx: LoadContext): object => {
      ctx.addLabeledAsset('Animation0', new AnimationClip([], 0, 'Idle'), clips);
      return {};
    };
    server.registerLoader('glbstub', parents, importParent);
    const manifest: AssetManifest = {
      entries: new Map([[PARENT, { guid: PARENT, location: 'hero.glbstub', kind: 'Gltf' }]]),
    };
    server.setManifest(manifest);

    // Resolves only because AnimationPlugin registered the 'Animation' store —
    // otherwise this throws /no sub-asset store/.
    const handle = server.loadByGuid<AnimationClip>(subAssetGuid(PARENT, 'Animation0'));
    await server.settle();
    applyCompletedLoads(server);

    expect(clips.get(handle)?.name).toBe('Idle');
  });
});
