import { describe, expect, it } from 'bun:test';

import type { AssetGuid } from '@retro-engine/assets';

import { bakeMeta, bakeMetaWithData, parseMeta, serializeMeta } from './meta';

const guid = 'g-1' as AssetGuid;

describe('asset meta', () => {
  it('round-trips an identity-only sidecar (no data)', () => {
    const meta = parseMeta(serializeMeta(bakeMeta(guid, 'Image')));
    expect(meta).toEqual({ version: 1, guid, kind: 'Image' });
    expect(meta.data).toBeUndefined();
  });

  it('round-trips a sidecar carrying a per-kind data body', () => {
    const data = { sprites: [{ x: 0, y: 0, w: 16, h: 16 }] };
    const meta = parseMeta(serializeMeta(bakeMetaWithData(guid, 'Image', data)));
    expect(meta.data).toEqual(data);
  });

  it('parses a legacy sidecar with no data field', () => {
    const meta = parseMeta(JSON.stringify({ version: 1, guid: 'g-2', kind: 'Mesh' }));
    expect(meta.kind).toBe('Mesh');
    expect(meta.data).toBeUndefined();
  });

  it('throws on a sidecar missing guid or kind', () => {
    expect(() => parseMeta(JSON.stringify({ version: 1, kind: 'Image' }))).toThrow();
    expect(() => parseMeta('"not an object"')).toThrow();
  });
});
