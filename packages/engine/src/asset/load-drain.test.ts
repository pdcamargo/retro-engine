import { describe, expect, it } from 'bun:test';

import type { AssetSource } from '@retro-engine/assets';
import { Assets } from '@retro-engine/assets';

import { App } from '../index';
import { RenderSet } from '../render-set';
import { Res } from '../system-param';
import { makeRenderingRenderer, makeStubCanvas } from '../test-utils';

import { AssetPlugin } from './asset-plugin';
import { AssetServer } from './asset-server';
import { applyCompletedLoads } from './load-drain';

class StubAsset {
  constructor(public readonly text: string) {}
}

const sourceFrom = (entries: Record<string, string>): AssetSource => ({
  read: (location) => {
    const value = entries[location];
    return value === undefined
      ? Promise.reject(new Error(`missing: ${location}`))
      : Promise.resolve(new TextEncoder().encode(value));
  },
});

const decodeStub = (bytes: Uint8Array): StubAsset => new StubAsset(new TextDecoder().decode(bytes));

describe('applyCompletedLoads', () => {
  it('commits a completed load into the store and queues an added event', async () => {
    const store = new Assets<StubAsset>();
    const server = new AssetServer({ source: sourceFrom({ 'a.stub': 'hi' }) });
    server.registerLoader('stub', store, decodeStub);

    const handle = server.load<StubAsset>('a.stub');
    await server.settle();
    applyCompletedLoads(server);

    expect(store.get(handle)?.text).toBe('hi');
    const events = store.drainEvents();
    expect(events.length).toBe(1);
    expect(events[0]?.kind).toBe('added');
  });

  it('reload commits behind the same handle and queues a modified event', async () => {
    const store = new Assets<StubAsset>();
    const entries: Record<string, string> = { 'a.stub': 'v1' };
    const server = new AssetServer({ source: sourceFrom(entries) });
    server.registerLoader('stub', store, decodeStub);

    const handle = server.load<StubAsset>('a.stub');
    await server.settle();
    applyCompletedLoads(server);
    store.drainEvents(); // clear the added event

    entries['a.stub'] = 'v2';
    server.reload('a.stub');
    await server.settle();
    applyCompletedLoads(server);

    expect(store.get(handle)?.text).toBe('v2');
    const events = store.drainEvents();
    expect(events.length).toBe(1);
    expect(events[0]?.kind).toBe('modified');
    expect(events[0]?.handle).toBe(handle);
  });
});

describe('load-drain ordering', () => {
  it('drains in preUpdate, before RenderSet.Extract reads the store', async () => {
    const store = new Assets<StubAsset>();
    const app = new App({ renderer: makeRenderingRenderer(), canvas: makeStubCanvas() });
    app.addPlugin(new AssetPlugin({ source: sourceFrom({ 'a.stub': 'ready' }) }));
    const server = app.getResource(AssetServer)!;
    server.registerLoader('stub', store, decodeStub);

    const handle = server.load<StubAsset>('a.stub');
    let seenDuringExtract: string | undefined;
    app.addSystem(
      'render',
      [Res(AssetServer)],
      () => {
        seenDuringExtract = store.get(handle)?.text;
      },
      { set: RenderSet.Extract },
    );

    await server.settle();
    await app.run();

    // The preUpdate drain ran before the render Extract probe in the same frame,
    // so the value loaded this frame was already in the store at extraction.
    expect(seenDuringExtract).toBe('ready');
  });
});
