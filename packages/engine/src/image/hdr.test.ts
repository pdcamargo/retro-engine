import { describe, expect, it } from 'bun:test';

import { createHdrImporter, decodeRadianceHdr, decodeRadianceHdrPreview } from './hdr';

const ascii = (s: string): number[] => Array.from(s, (c) => c.charCodeAt(0));

/** Build a Radiance HDR byte stream from a header + raw scanline bytes. */
const hdrBytes = (resolution: string, body: number[]): Uint8Array =>
  new Uint8Array([
    ...ascii('#?RADIANCE\n'),
    ...ascii('FORMAT=32-bit_rle_rgbe\n'),
    ...ascii('\n'),
    ...ascii(`${resolution}\n`),
    ...body,
  ]);

describe('decodeRadianceHdr', () => {
  it('decodes a flat (non-RLE) scanline with the shared-exponent scale', () => {
    // Two pixels at width 2 (< 8 → flat path). Exponent 128 → scale 2^-8, so a
    // mantissa byte b decodes to b/256.
    const bytes = hdrBytes('-Y 1 +X 2', [128, 64, 32, 128, 255, 128, 0, 129]);
    const { width, height, data } = decodeRadianceHdr(bytes);
    expect(width).toBe(2);
    expect(height).toBe(1);
    expect(data[0]).toBeCloseTo(0.5, 5); // 128 * 2^-8
    expect(data[1]).toBeCloseTo(0.25, 5); // 64 * 2^-8
    expect(data[2]).toBeCloseTo(0.125, 5); // 32 * 2^-8
    expect(data[3]).toBe(1); // alpha
    // Second pixel, exponent 129 → scale 2^-7.
    expect(data[4]).toBeCloseTo(255 / 128, 4);
    expect(data[6]).toBe(0);
  });

  it('decodes a new-style adaptive-RLE scanline (runs)', () => {
    // width 8: header [2,2,0,8], then one run per channel (count 128+8, value).
    const body = [
      2, 2, 0, 8,
      136, 128, // R: run of 8 × 128
      136, 64, // G: run of 8 × 64
      136, 32, // B: run of 8 × 32
      136, 128, // E: run of 8 × 128
    ];
    const { width, data } = decodeRadianceHdr(hdrBytes('-Y 1 +X 8', body));
    expect(width).toBe(8);
    for (let x = 0; x < 8; x++) {
      expect(data[x * 4]).toBeCloseTo(0.5, 5);
      expect(data[x * 4 + 1]).toBeCloseTo(0.25, 5);
      expect(data[x * 4 + 2]).toBeCloseTo(0.125, 5);
    }
  });

  it('emits zero for a zero-exponent pixel', () => {
    const { data } = decodeRadianceHdr(hdrBytes('-Y 1 +X 2', [200, 200, 200, 0, 10, 20, 30, 128]));
    expect(data[0]).toBe(0);
    expect(data[1]).toBe(0);
    expect(data[2]).toBe(0);
  });

  it('rejects a non-Radiance stream', () => {
    expect(() => decodeRadianceHdr(new Uint8Array(ascii('not an hdr\n')))).toThrow(/not a Radiance/);
  });
});

describe('decodeRadianceHdrPreview', () => {
  it('downsamples to the cap and tonemaps to sRGB RGBA8', () => {
    // 8-wide, 1-tall RLE scanline of a mid value; preview caps to 4 wide.
    const body = [2, 2, 0, 8, 136, 128, 136, 128, 136, 128, 136, 128];
    const preview = decodeRadianceHdrPreview(hdrBytes('-Y 1 +X 8', body), 4);
    expect(preview.width).toBe(4);
    expect(preview.height).toBe(1);
    expect(preview.data.length).toBe(4 * 4);
    // Linear 0.5 → Reinhard 1/3 → sRGB ≈ 0.6 → ~154; alpha is opaque.
    expect(preview.data[0]).toBeGreaterThan(140);
    expect(preview.data[0]).toBeLessThan(170);
    expect(preview.data[3]).toBe(255);
  });

  it('keeps small images at full size', () => {
    const preview = decodeRadianceHdrPreview(hdrBytes('-Y 1 +X 2', [128, 64, 32, 128, 255, 128, 0, 129]), 256);
    expect(preview.width).toBe(2);
    expect(preview.height).toBe(1);
  });
});

describe('createHdrImporter', () => {
  it('produces a linear rgba16float equirect image', () => {
    const importer = createHdrImporter();
    const bytes = hdrBytes('-Y 1 +X 2', [128, 64, 32, 128, 255, 128, 0, 129]);
    const image = importer(bytes, { path: 'sky.hdr' } as never) as import('./image').Image;
    expect(image.width).toBe(2);
    expect(image.height).toBe(1);
    expect(image.format).toBe('rgba16float');
    expect(image.colorSpace).toBe('linear');
    expect(image.dimension).toBe('2d');
    // rgba16float = 8 bytes/texel × 2 texels.
    expect(image.data.byteLength).toBe(2 * 8);
  });
});
