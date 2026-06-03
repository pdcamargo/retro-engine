import { describe, expect, it } from 'bun:test';

import { asAssetIndex, generateAssetGuid } from './asset-id';
import { Assets } from './assets';
import { makeHandle } from './handle';

interface Mesh {
  readonly label: string;
}

const mesh = (label: string): Mesh => ({ label });

describe('Assets — GUID index', () => {
  it('mints a guid on add and resolves it back to the same slot', () => {
    const assets = new Assets<Mesh>();
    const handle = assets.add(mesh('a'));
    expect(handle.guid).toBeDefined();

    const resolved = assets.handleByGuid(handle.guid!);
    expect(resolved).toBeDefined();
    expect(resolved!.index).toBe(handle.index);
    expect(resolved!.guid).toBe(handle.guid);
    expect(assets.get(resolved!)).toEqual(mesh('a'));
  });

  it('adopts an explicitly supplied guid (the manifest/loader path)', () => {
    const assets = new Assets<Mesh>();
    const guid = generateAssetGuid();
    const handle = assets.add(mesh('a'), guid);
    expect(handle.guid).toBe(guid);
    expect(assets.handleByGuid(guid)!.index).toBe(handle.index);
  });

  it('returns undefined for a guid not in the store', () => {
    const assets = new Assets<Mesh>();
    assets.add(mesh('a'));
    expect(assets.handleByGuid(generateAssetGuid())).toBeUndefined();
  });

  it('indexes a guid-bearing handle filled via insert', () => {
    const assets = new Assets<Mesh>();
    const guid = generateAssetGuid();
    const handle = makeHandle<Mesh>(asAssetIndex(42), guid);
    assets.insert(handle, mesh('late'));
    expect(assets.handleByGuid(guid)!.index).toBe(asAssetIndex(42));
  });

  it('drops the guid entry on remove', () => {
    const assets = new Assets<Mesh>();
    const handle = assets.add(mesh('a'));
    const guid = handle.guid!;
    assets.remove(handle);
    expect(assets.handleByGuid(guid)).toBeUndefined();
  });

  it('reserveHandle(guid) carries the guid so the inserted value is indexed', () => {
    const assets = new Assets<Mesh>();
    const guid = generateAssetGuid();
    const handle = assets.reserveHandle(guid);
    expect(handle.guid).toBe(guid);
    // Reserved but not filled: nothing to resolve yet.
    expect(assets.handleByGuid(guid)).toBeUndefined();

    assets.insert(handle, mesh('loaded'));
    const resolved = assets.handleByGuid(guid);
    expect(resolved!.index).toBe(handle.index);
    expect(assets.get(resolved!)).toEqual(mesh('loaded'));
  });

  it('reserveHandle() with no guid stays guid-less', () => {
    const assets = new Assets<Mesh>();
    expect(assets.reserveHandle().guid).toBeUndefined();
  });
});
