import { describe, expect, it } from 'bun:test';

import type { AssetGuid, AssetSource } from '@retro-engine/assets';
import { Assets, MANIFEST_FORMAT_VERSION, parseAssetManifest } from '@retro-engine/assets';

import { AssetServer } from './asset-server';
import { applyCompletedLoads } from './load-drain';

const manifestJson = (entries: { guid: string; location: string; kind: string }[]): string =>
  JSON.stringify({ version: MANIFEST_FORMAT_VERSION, entries });

const manifestWith = (entries: { guid: string; location: string; kind: string }[]) =>
  parseAssetManifest(manifestJson(entries));

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

describe('AssetServer', () => {
  it('returns a handle synchronously; the value is absent until committed', async () => {
    const store = new Assets<StubAsset>();
    const server = new AssetServer({ source: sourceFrom({ 'a.stub': 'hello' }) });
    server.registerLoader('stub', store, decodeStub);

    const handle = server.load<StubAsset>('a.stub');
    // Slot reserved, value not present yet.
    expect(store.get(handle)).toBeUndefined();

    await server.settle();
    // IO finished, but the result is queued — the drain, not the promise, moves
    // it into the store. So it is still absent until a frame runs.
    expect(store.get(handle)).toBeUndefined();
    expect(server.drainCompleted().length).toBe(1);
  });

  it('dedupes by path: a repeat load returns the same handle and starts no new IO', async () => {
    const store = new Assets<StubAsset>();
    let reads = 0;
    const source: AssetSource = {
      read: () => {
        reads += 1;
        return Promise.resolve(new TextEncoder().encode('x'));
      },
    };
    const server = new AssetServer({ source });
    server.registerLoader('stub', store, decodeStub);

    const first = server.load<StubAsset>('a.stub');
    const second = server.load<StubAsset>('a.stub');
    expect(second).toBe(first);

    await server.settle();
    expect(reads).toBe(1);
    expect(server.drainCompleted().length).toBe(1);
  });

  it('throws synchronously for an unregistered extension', () => {
    const server = new AssetServer({ source: sourceFrom({}) });
    expect(() => server.load('a.png')).toThrow(/no loader registered/);
  });

  it('throws synchronously for a path with no extension', () => {
    const store = new Assets<StubAsset>();
    const server = new AssetServer({ source: sourceFrom({}) });
    server.registerLoader('stub', store, decodeStub);
    expect(() => server.load('noext')).toThrow(/cannot derive a file extension/);
  });

  it('normalizes the extension and rejects a duplicate loader', () => {
    const store = new Assets<StubAsset>();
    const server = new AssetServer({ source: sourceFrom({}) });
    server.registerLoader('stub', store, decodeStub);
    expect(() => server.registerLoader('.STUB', store, decodeStub)).toThrow(/already registered/);
  });

  it('records a failure when the source rejects and commits nothing', async () => {
    const store = new Assets<StubAsset>();
    const server = new AssetServer({ source: sourceFrom({}) });
    server.registerLoader('stub', store, decodeStub);

    const handle = server.load<StubAsset>('miss.stub');
    await server.settle();

    expect(server.drainCompleted().length).toBe(0);
    const failures = server.drainFailures();
    expect(failures.length).toBe(1);
    expect(failures[0]?.path).toBe('miss.stub');
    expect(store.get(handle)).toBeUndefined();
  });

  it('loadByGuid resolves through the manifest and indexes the loaded value by guid', async () => {
    const store = new Assets<StubAsset>();
    const server = new AssetServer({ source: sourceFrom({ 'a.stub': 'hello' }) });
    server.registerLoader('stub', store, decodeStub);
    server.setManifest(manifestWith([{ guid: 'g1', location: 'a.stub', kind: 'Stub' }]));

    const handle = server.loadByGuid<StubAsset>('g1' as AssetGuid);
    expect(handle.guid).toBe('g1' as AssetGuid);
    expect(store.get(handle)).toBeUndefined();

    await server.settle();
    applyCompletedLoads(server);

    const resolved = store.handleByGuid('g1' as AssetGuid);
    expect(resolved).toBeDefined();
    expect(store.get(resolved!)?.text).toBe('hello');
  });

  it('dedupes by guid: a repeat loadByGuid returns the same handle and starts no new IO', async () => {
    const store = new Assets<StubAsset>();
    let reads = 0;
    const source: AssetSource = {
      read: () => {
        reads += 1;
        return Promise.resolve(new TextEncoder().encode('x'));
      },
    };
    const server = new AssetServer({ source });
    server.registerLoader('stub', store, decodeStub);
    server.setManifest(manifestWith([{ guid: 'g1', location: 'a.stub', kind: 'Stub' }]));

    const first = server.loadByGuid<StubAsset>('g1' as AssetGuid);
    const second = server.loadByGuid<StubAsset>('g1' as AssetGuid);
    expect(second).toBe(first);

    await server.settle();
    expect(reads).toBe(1);
  });

  it('throws when no manifest is set', () => {
    const server = new AssetServer({ source: sourceFrom({}) });
    expect(() => server.loadByGuid('g1' as AssetGuid)).toThrow(/no manifest set/);
  });

  it('throws for a guid absent from the manifest', () => {
    const server = new AssetServer({ source: sourceFrom({}) });
    server.setManifest(manifestWith([]));
    expect(() => server.loadByGuid('missing' as AssetGuid)).toThrow(/not in the manifest/);
  });

  it('loadManifest reads and parses a manifest through the injected source', async () => {
    const store = new Assets<StubAsset>();
    const server = new AssetServer({
      source: sourceFrom({
        'manifest.json': manifestJson([{ guid: 'g1', location: 'a.stub', kind: 'Stub' }]),
        'a.stub': 'hi',
      }),
    });
    server.registerLoader('stub', store, decodeStub);
    await server.loadManifest('manifest.json');

    server.loadByGuid<StubAsset>('g1' as AssetGuid);
    await server.settle();
    applyCompletedLoads(server);
    expect(store.get(store.handleByGuid('g1' as AssetGuid)!)?.text).toBe('hi');
  });
});
