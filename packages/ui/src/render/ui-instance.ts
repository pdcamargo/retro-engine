/**
 * Per-instance data for a UI quad: a clip-space rect (4 × f32) plus a packed
 * RGBA color (1 × u32, `unorm8x4`). 5 4-byte slots = 20 bytes.
 */
export const UI_INSTANCE_FLOAT_COUNT = 5;

/** Byte size of one packed UI quad instance. */
export const UI_INSTANCE_BYTE_SIZE = UI_INSTANCE_FLOAT_COUNT * 4;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Pack a linear RGBA color (channels in `[0, 1]`) into a little-endian `u32`
 * matching the `unorm8x4` vertex format (byte order R, G, B, A → x, y, z, w).
 */
export const packUiColor = (r: number, g: number, b: number, a: number): number => {
  const ri = Math.round(clamp01(r) * 255);
  const gi = Math.round(clamp01(g) * 255);
  const bi = Math.round(clamp01(b) * 255);
  const ai = Math.round(clamp01(a) * 255);
  return ((ai << 24) | (bi << 16) | (gi << 8) | ri) >>> 0;
};

/**
 * Write one quad instance into the interleaved scratch views at `floatCursor`
 * (a slot index, not a byte offset): the clip rect as four f32s, then the packed
 * color as one u32.
 */
export const packUiQuad = (
  clipLeft: number,
  clipTop: number,
  clipRight: number,
  clipBottom: number,
  packedColor: number,
  f32: Float32Array,
  u32: Uint32Array,
  floatCursor: number,
): void => {
  f32[floatCursor] = clipLeft;
  f32[floatCursor + 1] = clipTop;
  f32[floatCursor + 2] = clipRight;
  f32[floatCursor + 3] = clipBottom;
  u32[floatCursor + 4] = packedColor;
};
