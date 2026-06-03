import { describe, expect, it } from 'bun:test';

import { Assets, generateAssetGuid } from '@retro-engine/assets';

import { AssetStores } from './asset-stores';

interface Tex {
  readonly id: number;
}

describe('AssetStores', () => {
  it('resolves a registered store handle by guid', () => {
    const stores = new AssetStores();
    const tex = new Assets<Tex>();
    const handle = tex.add({ id: 1 });
    stores.register('Tex', tex as Assets<unknown>);

    const resolved = stores.handleFor('Tex', handle.guid!);
    expect(resolved.index).toBe(handle.index);
    expect(resolved.guid).toBe(handle.guid);
  });

  it('throws for an asset type with no registered store', () => {
    const stores = new AssetStores();
    expect(() => stores.handleFor('Nope', generateAssetGuid())).toThrow(
      /no asset store registered for type 'Nope'/,
    );
  });

  it('throws for a guid absent from its store', () => {
    const stores = new AssetStores();
    stores.register('Tex', new Assets<Tex>() as Assets<unknown>);
    expect(() => stores.handleFor('Tex', generateAssetGuid())).toThrow(/not present in its store/);
  });
});
