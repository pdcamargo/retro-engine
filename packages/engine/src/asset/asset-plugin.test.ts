import { describe, expect, it } from 'bun:test';

import type { AssetSource } from '@retro-engine/assets';
import { Assets } from '@retro-engine/assets';

import { App } from '../index';
import type { Logger } from '../log';
import { makeHeadlessRenderer } from '../test-utils';

import { AssetPlugin } from './asset-plugin';
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

const createWarnSpy = (): { logger: Logger; warns: string[] } => {
  const warns: string[] = [];
  const logger: Logger = {
    error: () => undefined,
    warn: (m) => {
      warns.push(m);
    },
    info: () => undefined,
    debug: () => undefined,
    devWarn: () => undefined,
    child: () => logger,
  };
  return { logger, warns };
};

describe('AssetPlugin', () => {
  it('inserts an AssetServer on build', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    app.addPlugin(new AssetPlugin({ source: sourceFrom({}) }));
    expect(app.getResource(AssetServer)).toBeInstanceOf(AssetServer);
  });

  it('drains a completed load into its store on the next frame', async () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    app.addPlugin(new AssetPlugin({ source: sourceFrom({ 'a.stub': 'hi' }) }));
    const store = new Assets<StubAsset>();
    const server = app.getResource(AssetServer)!;
    server.registerLoader('stub', store, decodeStub);

    const handle = server.load<StubAsset>('a.stub');
    await server.settle();
    app.advanceFrame();

    expect(store.get(handle)?.text).toBe('hi');
  });

  it('logs load failures through the drain', async () => {
    const spy = createWarnSpy();
    const app = new App({ renderer: makeHeadlessRenderer(), logger: spy.logger });
    app.addPlugin(new AssetPlugin({ source: sourceFrom({}) }));
    const store = new Assets<StubAsset>();
    const server = app.getResource(AssetServer)!;
    server.registerLoader('stub', store, decodeStub);

    server.load<StubAsset>('miss.stub');
    await server.settle();
    app.advanceFrame();

    expect(spy.warns.some((m) => m.includes('miss.stub'))).toBe(true);
  });
});
