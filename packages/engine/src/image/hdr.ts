import type { AssetImporter } from '@retro-engine/assets';

import { Image } from './image';

/** A decoded Radiance HDR image: linear RGBA float pixels, top-left origin. */
export interface DecodedHdr {
  readonly width: number;
  readonly height: number;
  /** Linear RGBA, 4 floats per pixel, row-major from the top. Alpha is always 1. */
  readonly data: Float32Array;
}

interface Cursor {
  pos: number;
}

interface HdrHeader {
  readonly width: number;
  readonly height: number;
  /** Byte offset of the first scanline. */
  readonly bodyStart: number;
}

/** Parse the Radiance header, returning the resolution and the scanline offset. */
const parseHeader = (bytes: Uint8Array): HdrHeader => {
  const cursor: Cursor = { pos: 0 };
  const readLine = (): string => {
    let line = '';
    while (cursor.pos < bytes.length) {
      const c = bytes[cursor.pos++]!;
      if (c === 0x0a) break;
      line += String.fromCharCode(c);
    }
    return line;
  };

  if (!readLine().startsWith('#?')) {
    throw new Error('decodeRadianceHdr: not a Radiance HDR file (missing "#?" magic).');
  }
  let format: string | undefined;
  for (;;) {
    const line = readLine();
    if (line === '') break; // blank line terminates the header
    const eq = line.indexOf('=');
    if (eq !== -1 && line.slice(0, eq).toUpperCase() === 'FORMAT') {
      format = line.slice(eq + 1).trim();
    }
  }
  if (format !== undefined && format !== '32-bit_rle_rgbe' && format !== '32-bit_rle_xyze') {
    throw new Error(`decodeRadianceHdr: unsupported FORMAT '${format}'.`);
  }

  const resolution = readLine();
  // Standard orientation is "-Y <height> +X <width>". Other axis orders exist
  // but are vanishingly rare for environment HDRIs; reject them loudly.
  const match = /^-Y\s+(\d+)\s+\+X\s+(\d+)/.exec(resolution);
  if (match === null) {
    throw new Error(`decodeRadianceHdr: unsupported resolution line '${resolution}'.`);
  }
  return { height: Number(match[1]), width: Number(match[2]), bodyStart: cursor.pos };
};

/** RGBE byte triple + shared exponent → linear float, written into `out` at `o`. */
const rgbeToFloat = (
  r: number,
  g: number,
  b: number,
  e: number,
  out: Float32Array,
  o: number,
): void => {
  if (e === 0) {
    out[o] = 0;
    out[o + 1] = 0;
    out[o + 2] = 0;
  } else {
    // value = mantissa * 2^(exponent - 128 - 8); the -8 normalizes the byte
    // mantissa to [0,1) before the shared exponent scale.
    const scale = Math.pow(2, e - 136);
    out[o] = r * scale;
    out[o + 1] = g * scale;
    out[o + 2] = b * scale;
  }
  out[o + 3] = 1;
};

/**
 * Iterate an HDR's pixels, optionally downsampled so the longest side is capped
 * to `maxDim`. Reads every source scanline (RLE requires it) but only invokes
 * `pixel` for the kept rows/columns, with linear-float RGB — so a huge HDRI
 * never materializes its full float buffer. Returns the output dimensions.
 *
 * Downsampling is nearest-sample (pick), which is adequate for skybox / IBL use
 * where the result is further blurred (prefilter) or only a background.
 */
const decodeScaled = (
  bytes: Uint8Array,
  maxDim: number,
  onStart: (outW: number, outH: number) => void,
  pixel: (ox: number, oy: number, outW: number, r: number, g: number, b: number) => void,
): { width: number; height: number } => {
  const { width, height, bodyStart } = parseHeader(bytes);
  const scale = Math.min(1, maxDim / Math.max(width, height));
  const outW = Math.max(1, Math.round(width * scale));
  const outH = Math.max(1, Math.round(height * scale));
  onStart(outW, outH);

  const cursor: Cursor = { pos: bodyStart };
  const scanline = new Uint8Array(width * 4);
  const rgb = new Float32Array(4);
  let nextOut = 0;
  for (let y = 0; y < height; y++) {
    readScanline(bytes, cursor, width, scanline);
    const targetRow = Math.min(outH - 1, Math.floor((y * outH) / height));
    if (targetRow < nextOut) continue; // a row between kept rows — read, discard
    nextOut = targetRow + 1;
    for (let ox = 0; ox < outW; ox++) {
      const sx = Math.min(width - 1, Math.floor((ox * width) / outW));
      rgbeToFloat(scanline[sx * 4]!, scanline[sx * 4 + 1]!, scanline[sx * 4 + 2]!, scanline[sx * 4 + 3]!, rgb, 0);
      pixel(ox, targetRow, outW, rgb[0]!, rgb[1]!, rgb[2]!);
    }
  }
  return { width: outW, height: outH };
};

/**
 * Decode a Radiance RGBE (`.hdr`) image into linear float RGBA.
 *
 * Supports the new-style adaptive RLE scanline encoding (the common case for
 * `.hdr` files) and the flat / old-RLE fallback. Returns top-left-origin pixels
 * so the result maps directly onto an equirectangular {@link Image}. Pass
 * `maxDim` to cap the longest side (nearest-downsampled) — e.g. to fit a large
 * panorama within the GPU's max texture dimension.
 *
 * @throws if the byte stream is not a Radiance file or declares an unsupported
 *         format.
 */
export const decodeRadianceHdr = (bytes: Uint8Array, maxDim = Infinity): DecodedHdr => {
  let data = new Float32Array(0);
  const { width, height } = decodeScaled(
    bytes,
    maxDim,
    (outW, outH) => {
      data = new Float32Array(outW * outH * 4);
    },
    (ox, oy, outW, r, g, b) => {
      const o = (oy * outW + ox) * 4;
      data[o] = r;
      data[o + 1] = g;
      data[o + 2] = b;
      data[o + 3] = 1;
    },
  );
  return { width, height, data };
};

/** A downsampled, tonemapped LDR preview of an HDR image (RGBA8, sRGB-encoded). */
export interface HdrPreview {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}

/**
 * Decode a Radiance `.hdr` into a small sRGB-encoded RGBA8 preview, tonemapped
 * with Reinhard so out-of-range values stay visible. Downsamples on the fly —
 * the longest side is capped to `maxDim` and only the kept rows/columns are
 * stored, so a large HDRI never materializes its full float buffer (the source
 * is still scanned once, as RLE requires). Intended for asset-browser
 * thumbnails and other LDR previews.
 */
export const decodeRadianceHdrPreview = (bytes: Uint8Array, maxDim = 256): HdrPreview => {
  let out = new Uint8Array(0);
  const { width, height } = decodeScaled(
    bytes,
    maxDim,
    (outW, outH) => {
      out = new Uint8Array(outW * outH * 4);
    },
    (ox, oy, outW, r, g, b) => {
      const o = (oy * outW + ox) * 4;
      // Reinhard tonemap keeps out-of-range values visible, then sRGB encode.
      out[o] = linearToSrgbByte(r / (1 + r));
      out[o + 1] = linearToSrgbByte(g / (1 + g));
      out[o + 2] = linearToSrgbByte(b / (1 + b));
      out[o + 3] = 255;
    },
  );
  return { width, height, data: out };
};

/** Linear [0,1] → sRGB-encoded byte [0,255]. */
const linearToSrgbByte = (l: number): number => {
  const c = l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(c * 255)));
};

/** Read one RGBE scanline into `out` (length `width*4`), advancing the cursor. */
const readScanline = (bytes: Uint8Array, cursor: Cursor, width: number, out: Uint8Array): void => {
  let pos = cursor.pos;
  // New-style adaptive RLE: a 4-byte header [2, 2, widthHi, widthLo].
  const newRle =
    width >= 8 &&
    width < 32768 &&
    bytes[pos] === 2 &&
    bytes[pos + 1] === 2 &&
    ((bytes[pos + 2]! << 8) | bytes[pos + 3]!) === width;
  if (!newRle) {
    readFlatScanline(bytes, cursor, width, out);
    return;
  }
  pos += 4;
  for (let channel = 0; channel < 4; channel++) {
    let x = 0;
    while (x < width) {
      let count = bytes[pos++]!;
      if (count > 128) {
        // A run: the next byte repeats (count - 128) times.
        count -= 128;
        const value = bytes[pos++]!;
        for (let i = 0; i < count; i++) out[(x++) * 4 + channel] = value;
      } else {
        // A dump: `count` literal bytes follow.
        for (let i = 0; i < count; i++) out[(x++) * 4 + channel] = bytes[pos++]!;
      }
    }
  }
  cursor.pos = pos;
};

/** Read a flat (or old-RLE) RGBE scanline. */
const readFlatScanline = (bytes: Uint8Array, cursor: Cursor, width: number, out: Uint8Array): void => {
  let pos = cursor.pos;
  let x = 0;
  let shift = 0;
  while (x < width) {
    const r = bytes[pos++]!;
    const g = bytes[pos++]!;
    const b = bytes[pos++]!;
    const e = bytes[pos++]!;
    // Old-style RLE marker: r=g=b=1, exponent carries a repeat count shifted up.
    if (r === 1 && g === 1 && b === 1) {
      const count = e << shift;
      const o = (x - 1) * 4;
      for (let i = 0; i < count; i++) {
        out[x * 4] = out[o]!;
        out[x * 4 + 1] = out[o + 1]!;
        out[x * 4 + 2] = out[o + 2]!;
        out[x * 4 + 3] = out[o + 3]!;
        x++;
      }
      shift += 8;
    } else {
      out[x * 4] = r;
      out[x * 4 + 1] = g;
      out[x * 4 + 2] = b;
      out[x * 4 + 3] = e;
      x++;
      shift = 0;
    }
  }
  cursor.pos = pos;
};

/** IEEE-754 float32 → float16 bit pattern, for packing `rgba16float` texels. */
const floatToHalf = (value: number): number => {
  F32[0] = value;
  const x = U32[0]!;
  const sign = (x >> 16) & 0x8000;
  let mantissa = x & 0x007fffff;
  let exp = (x >> 23) & 0xff;
  if (exp === 0xff) {
    // Inf / NaN.
    return sign | 0x7c00 | (mantissa !== 0 ? 0x0200 : 0);
  }
  exp = exp - 127 + 15;
  if (exp >= 0x1f) return sign | 0x7c00; // overflow → Inf
  if (exp <= 0) {
    if (exp < -10) return sign; // underflow → 0
    mantissa = (mantissa | 0x00800000) >> (1 - exp);
    return sign | (mantissa >> 13);
  }
  return sign | (exp << 10) | (mantissa >> 13);
};
const F32 = new Float32Array(1);
const U32 = new Uint32Array(F32.buffer);

/** Pack linear float RGBA into `rgba16float` bytes (8 bytes/texel). */
const packRgba16f = (floats: Float32Array): Uint8Array => {
  const halves = new Uint16Array(floats.length);
  for (let i = 0; i < floats.length; i++) halves[i] = floatToHalf(floats[i]!);
  return new Uint8Array(halves.buffer);
};

/**
 * Asset importer that decodes a Radiance `.hdr` byte stream into a linear
 * `rgba16float` equirectangular {@link Image}. Register it with the
 * `AssetServer` for the `'hdr'` extension; the resulting 2D image is converted
 * to a cube on demand by the skybox / environment systems.
 */
/**
 * Longest-side cap applied when importing an HDRI to a GPU image. Keeps a
 * large panorama within the WebGPU max 2D texture dimension (8192) with
 * headroom, and bounds memory — the equirect is converted to a cube for the
 * skybox / IBL anyway, so multi-thousand-pixel source width buys nothing.
 */
const IMPORTER_MAX_DIM = 4096;

export const createHdrImporter = (): AssetImporter<Image> => (bytes: Uint8Array): Image => {
  const decoded = decodeRadianceHdr(bytes, IMPORTER_MAX_DIM);
  return Image.fromBytes({
    data: packRgba16f(decoded.data),
    format: 'rgba16float',
    colorSpace: 'linear',
    width: decoded.width,
    height: decoded.height,
    label: 'hdr',
  });
};
