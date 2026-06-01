import { describe, expect, it } from 'bun:test';

import { detectImageMime } from './image-source';
import { expectGltfError } from './test-support';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
const KTX2 = new Uint8Array([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a]);

describe('detectImageMime', () => {
  it('honors a declared mimeType', () => {
    expect(detectImageMime(new Uint8Array(), { mimeType: 'image/png' })).toBe('image/png');
  });

  it('normalizes image/jpg to image/jpeg', () => {
    expect(detectImageMime(new Uint8Array(), { mimeType: 'image/jpg' })).toBe('image/jpeg');
  });

  it('falls back to the URI extension', () => {
    expect(detectImageMime(new Uint8Array(), { uri: 'textures/wood.JPEG' })).toBe('image/jpeg');
    expect(detectImageMime(new Uint8Array(), { uri: 'envmap.ktx2?v=2' })).toBe('image/ktx2');
  });

  it('falls back to magic bytes', () => {
    expect(detectImageMime(PNG)).toBe('image/png');
    expect(detectImageMime(JPEG)).toBe('image/jpeg');
    expect(detectImageMime(KTX2)).toBe('image/ktx2');
  });

  it('recognizes KTX2 (decode deferred, but classified)', () => {
    expect(detectImageMime(new Uint8Array(), { mimeType: 'image/ktx2' })).toBe('image/ktx2');
  });

  it('rejects an explicitly unsupported format', () => {
    expectGltfError(() => detectImageMime(new Uint8Array(), { mimeType: 'image/webp' }), 'unsupported-image-mime');
  });

  it('rejects undetectable bytes', () => {
    expectGltfError(() => detectImageMime(new Uint8Array([0, 1, 2, 3])), 'unsupported-image-mime');
  });
});
