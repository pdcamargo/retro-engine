import { describe, expect, it } from 'bun:test';

import type { BrowserAsset } from '../project/project-browser';
import {
  assetTypeSpec,
  buildFolderTree,
  filterAssets,
  folderOf,
  isCompatible,
  presentTypes,
  sortAssets,
} from './asset-picker-catalog';

const asset = (over: Partial<BrowserAsset> & Pick<BrowserAsset, 'guid' | 'name' | 'type' | 'location'>): BrowserAsset => ({
  thumbnailable: false,
  ...over,
});

const POOL: BrowserAsset[] = [
  asset({ guid: 'a', name: 'crate.png', type: 'image', location: 'assets/textures/environment/crate.png' }),
  asset({ guid: 'b', name: 'grass.png', type: 'image', location: 'assets/textures/environment/grass.png' }),
  asset({ guid: 'c', name: 'coin.png', type: 'image', location: 'assets/sprites/items/coin.png' }),
  asset({ guid: 'd', name: 'hero.rmesh', type: 'mesh', location: 'assets/models/hero.rmesh' }),
  asset({ guid: 'e', name: 'brass.remat', type: 'material', location: 'assets/materials/brass.remat' }),
];

describe('assetTypeSpec', () => {
  it('maps known store names to assignable browser types and a noun', () => {
    expect(assetTypeSpec('Image')).toEqual({ types: ['image'], noun: 'Texture' });
    expect(assetTypeSpec('Mesh')).toEqual({ types: ['mesh'], noun: 'Mesh' });
    expect(assetTypeSpec('TextureAtlasLayout').types).toEqual([]);
  });

  it('treats any material store name as a material slot', () => {
    expect(assetTypeSpec('Materials2d<ColorMaterial2d>')).toEqual({ types: ['material'], noun: 'Material' });
  });

  it('returns a free-browse spec for null (Any) and unknown stores', () => {
    expect(assetTypeSpec(null)).toEqual({ types: null, noun: 'Asset' });
    expect(assetTypeSpec('Weird')).toEqual({ types: null, noun: 'Weird' });
  });
});

describe('isCompatible', () => {
  it('accepts everything under a null (Any) spec', () => {
    const spec = assetTypeSpec(null);
    expect(POOL.every((a) => isCompatible(a, spec))).toBe(true);
  });

  it('accepts only matching types under a type-locked spec', () => {
    const spec = assetTypeSpec('Image');
    expect(POOL.filter((a) => isCompatible(a, spec)).map((a) => a.guid)).toEqual(['a', 'b', 'c']);
  });
});

describe('folderOf / buildFolderTree', () => {
  it('derives the folder from a location', () => {
    expect(folderOf('assets/textures/crate.png')).toBe('assets/textures');
    expect(folderOf('crate.png')).toBe('');
  });

  it('nests folders and counts the whole subtree', () => {
    const root = buildFolderTree(POOL);
    const assetsNode = root.children.get('assets')!;
    expect(assetsNode.count).toBe(5);
    const textures = assetsNode.children.get('textures')!;
    expect(textures.count).toBe(2);
    expect(textures.children.get('environment')!.path).toBe('assets/textures/environment');
  });
});

describe('filterAssets', () => {
  const base = {
    spec: assetTypeSpec(null),
    folder: 'all',
    typeFilter: 'all',
    query: '',
    favorites: new Set<string>(),
    recent: [] as string[],
  };

  it('type-locks to compatible assets', () => {
    const out = filterAssets(POOL, { ...base, spec: assetTypeSpec('Image') });
    expect(out.map((a) => a.guid)).toEqual(['a', 'b', 'c']);
  });

  it('scopes to a folder subtree', () => {
    const out = filterAssets(POOL, { ...base, folder: 'assets/textures' });
    expect(out.map((a) => a.guid).sort()).toEqual(['a', 'b']);
  });

  it('filters favorites and recents smart folders', () => {
    expect(filterAssets(POOL, { ...base, folder: 'fav', favorites: new Set(['d']) }).map((a) => a.guid)).toEqual(['d']);
    expect(filterAssets(POOL, { ...base, folder: 'recent', recent: ['e'] }).map((a) => a.guid)).toEqual(['e']);
  });

  it('applies the type chip and the search query', () => {
    expect(filterAssets(POOL, { ...base, typeFilter: 'mesh' }).map((a) => a.guid)).toEqual(['d']);
    expect(filterAssets(POOL, { ...base, query: 'coin' }).map((a) => a.guid)).toEqual(['c']);
  });
});

describe('sortAssets', () => {
  it('sorts by name, type, and recency', () => {
    expect(sortAssets([...POOL], 'name', []).map((a) => a.name)[0]).toBe('brass.remat');
    expect(sortAssets([...POOL], 'type', []).map((a) => a.type)[0]).toBe('image');
    expect(sortAssets([...POOL], 'recent', ['d', 'e']).slice(0, 2).map((a) => a.guid)).toEqual(['d', 'e']);
  });
});

describe('presentTypes', () => {
  it('lists distinct compatible types in a stable order', () => {
    expect(presentTypes(POOL, assetTypeSpec(null))).toEqual(['image', 'material', 'mesh']);
    expect(presentTypes(POOL, assetTypeSpec('Image'))).toEqual(['image']);
  });
});
