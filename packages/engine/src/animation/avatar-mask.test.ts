import { describe, expect, it } from 'bun:test';

import { AvatarMask } from './avatar-mask';
import { createAvatarMaskSerializer } from './avatar-mask-asset';

describe('AvatarMask', () => {
  it('reports membership by target id', () => {
    const mask = new AvatarMask(['3', '7']);
    expect(mask.has('3')).toBe(true);
    expect(mask.has('7')).toBe(true);
    expect(mask.has('4')).toBe(false);
    expect(mask.size).toBe(2);
  });

  it('coalesces duplicate ids and supports include/exclude', () => {
    const mask = new AvatarMask(['1', '1']);
    expect(mask.size).toBe(1);
    mask.include('2');
    mask.exclude('1');
    expect(mask.ids()).toEqual(['2']);
  });

  it('round-trips through the serializer', () => {
    const serializer = createAvatarMaskSerializer();
    const original = new AvatarMask(['spine', 'arm.L', 'arm.R'], 'upper-body');
    const restored = serializer.deserialize(serializer.serialize(original));
    expect(restored.name).toBe('upper-body');
    expect(restored.ids()).toEqual(['spine', 'arm.L', 'arm.R']);
  });

  it('rejects an unknown format version', () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ version: 999, included: [] }));
    expect(() => createAvatarMaskSerializer().deserialize(bytes)).toThrow();
  });
});
