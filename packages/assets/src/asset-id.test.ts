import { describe, expect, it } from 'bun:test';

import { asAssetIndex, assetIndexOf, generateAssetGuid } from './asset-id';
import type { AssetId } from './asset-id';

interface Mesh {
  readonly __mesh: 'mesh';
}

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('generateAssetGuid', () => {
  it('produces a random v4 UUID', () => {
    expect(generateAssetGuid()).toMatch(V4);
  });

  it('is unique per call', () => {
    expect(generateAssetGuid()).not.toBe(generateAssetGuid());
  });
});

describe('assetIndexOf', () => {
  it('returns the index for a runtime id', () => {
    const id: AssetId<Mesh> = { kind: 'runtime', index: asAssetIndex(7) };
    expect(assetIndexOf(id)).toBe(asAssetIndex(7));
  });

  it('returns the index for a guid-backed id', () => {
    const id: AssetId<Mesh> = {
      kind: 'guid',
      index: asAssetIndex(7),
      guid: generateAssetGuid(),
    };
    expect(assetIndexOf(id)).toBe(asAssetIndex(7));
  });
});
