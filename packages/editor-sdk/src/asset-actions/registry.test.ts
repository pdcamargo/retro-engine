import { describe, expect, it } from 'bun:test';

import {
  type AssetActionContext,
  type AssetActionHost,
  type AssetActionTarget,
  createAssetActionRegistry,
} from './registry';

const noopHost: AssetActionHost = {
  beginCreate: () => {},
  beginRename: () => {},
  deleteAsset: () => {},
};

const target = (over: Partial<AssetActionTarget> = {}): AssetActionTarget => ({
  guid: 'g1',
  name: 'thing.ranimctrl',
  type: 'animation',
  assetKind: 'AnimationController',
  location: 'assets/thing.ranimctrl',
  isChild: false,
  ...over,
});

const assetCtx = (over: Partial<AssetActionTarget> = {}): AssetActionContext => ({
  asset: target(over),
  folder: 'assets',
  host: noopHost,
});

const labels = (entries: readonly { label?: string | undefined }[]): (string | undefined)[] =>
  entries.map((e) => e.label);

describe('AssetActionRegistry', () => {
  it('combines all-asset + the target type and kind, sorted by order', () => {
    const r = createAssetActionRegistry();
    r.registerForAll({ id: 'a', label: 'All', order: 10, run: () => {} })
      .registerForType('animation', { id: 't', label: 'ByType', order: 5, run: () => {} })
      .registerForType('AnimationController', { id: 'k', label: 'ByKind', order: 20, run: () => {} });
    expect(labels(r.buildAssetMenu(assetCtx()))).toEqual(['ByType', 'All', 'ByKind']);
  });

  it('does not leak a type action to a different type', () => {
    const r = createAssetActionRegistry();
    r.registerForType('material', { id: 'm', label: 'MatOnly', run: () => {} });
    expect(r.buildAssetMenu(assetCtx({ type: 'animation', assetKind: 'AnimationController' }))).toEqual([]);
    expect(labels(r.buildAssetMenu(assetCtx({ type: 'material', assetKind: 'StandardMaterial' })))).toEqual(['MatOnly']);
  });

  it('hides actions whose `when` returns false', () => {
    const r = createAssetActionRegistry();
    r.registerForAll({ id: 'child-only', label: 'Child', when: (c) => c.asset?.isChild === true, run: () => {} });
    expect(r.buildAssetMenu(assetCtx({ isChild: false }))).toEqual([]);
    expect(labels(r.buildAssetMenu(assetCtx({ isChild: true })))).toEqual(['Child']);
  });

  it('collapses grouped actions into a submenu at the group first position', () => {
    const r = createAssetActionRegistry();
    r.registerForPanel({ id: 'c1', label: 'Create Controller', group: 'Animation', order: 10, run: () => {} })
      .registerForPanel({ id: 'c2', label: 'Create Clip', group: 'Animation', order: 20, run: () => {} });
    const menu = r.buildPanelMenu({ folder: 'assets', host: noopHost });
    expect(menu).toHaveLength(1);
    expect(menu[0]?.label).toBe('Animation');
    expect(labels(menu[0]?.submenu ?? [])).toEqual(['Create Controller', 'Create Clip']);
  });

  it('emits a separator before an action that requests one', () => {
    const r = createAssetActionRegistry();
    r.registerForAll({ id: 'open', label: 'Open', order: 10, run: () => {} }).registerForAll({
      id: 'del',
      label: 'Delete',
      order: 20,
      separatorBefore: true,
      run: () => {},
    });
    const menu = r.buildAssetMenu(assetCtx());
    expect(menu).toHaveLength(3);
    expect(menu[1]?.separator).toBe(true);
    expect(menu[2]?.label).toBe('Delete');
  });
});
