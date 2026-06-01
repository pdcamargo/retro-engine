import { describe, expect, it } from 'bun:test';

import type { AssetSource } from '@retro-engine/assets';
import { Assets } from '@retro-engine/assets';

import { AssetServer } from './asset-server';

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
});
