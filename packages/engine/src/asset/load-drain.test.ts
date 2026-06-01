import { describe, expect, it } from 'bun:test';

import type { AssetSource, Handle, LoadContext } from '@retro-engine/assets';
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

class CompositeRoot {
  constructor(
    public readonly bin: string,
    public readonly parts: readonly Handle<StubAsset>[],
  ) {}
}

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

  it('commits a multi-asset load — sub-assets and root — visible to Extract in one frame', async () => {
    const parts = new Assets<StubAsset>();
    const roots = new Assets<CompositeRoot>();

    // A composite importer: reads a sibling .bin and registers two sub-assets,
    // then returns a root holding their handles. The owning plugin would close
    // over the sub-asset store; here the test closes over `parts`.
    const importComposite = async (
      _bytes: Uint8Array,
      ctx: LoadContext,
    ): Promise<CompositeRoot> => {
      const bin = new TextDecoder().decode(await ctx.read('scene.bin'));
      const a = ctx.addLabeledAsset('Part0', new StubAsset('part-a'), parts);
      const b = ctx.addLabeledAsset('Part1', new StubAsset('part-b'), parts);
      return new CompositeRoot(bin, [a, b]);
    };

    const app = new App({ renderer: makeRenderingRenderer(), canvas: makeStubCanvas() });
    app.addPlugin(
      new AssetPlugin({ source: sourceFrom({ 'scene.composite': 'root', 'scene.bin': 'BINDATA' }) }),
    );
    const server = app.getResource(AssetServer)!;
    server.registerLoader('composite', roots, importComposite);

    const rootHandle = server.load<CompositeRoot>('scene.composite');

    let rootSeen: CompositeRoot | undefined;
    let partsSeen: (string | undefined)[] = [];
    app.addSystem(
      'render',
      [Res(AssetServer)],
      () => {
        rootSeen = roots.get(rootHandle);
        partsSeen = (rootSeen?.parts ?? []).map((h) => parts.get(h)?.text);
      },
      { set: RenderSet.Extract },
    );

    await server.settle();
    await app.run();

    // Root and both sub-assets are all present at extraction, in the same frame,
    // and the sibling read was decoded into the root.
    expect(rootSeen?.bin).toBe('BINDATA');
    expect(partsSeen).toEqual(['part-a', 'part-b']);
  });
});

describe('multi-asset load failure', () => {
  it('leaks no partial subgraph when the importer throws after registering sub-assets', async () => {
    const parts = new Assets<StubAsset>();
    const roots = new Assets<CompositeRoot>();

    const importThrows = (_bytes: Uint8Array, ctx: LoadContext): CompositeRoot => {
      ctx.addLabeledAsset('Part0', new StubAsset('part-a'), parts);
      throw new Error('decode failed');
    };

    const server = new AssetServer({ source: sourceFrom({ 'bad.composite': 'root' }) });
    server.registerLoader('composite', roots, importThrows);

    const rootHandle = server.load<CompositeRoot>('bad.composite');
    await server.settle();
    applyCompletedLoads(server);

    // No sub-asset committed, no event queued, root slot empty.
    expect(parts.size).toBe(0);
    expect(parts.drainEvents().length).toBe(0);
    expect(roots.get(rootHandle)).toBeUndefined();

    // The failure is recorded against the load path.
    const failures = server.drainFailures();
    expect(failures.length).toBe(1);
    expect(failures[0]?.path).toBe('bad.composite');
  });
});
