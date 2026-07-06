/**
 * Per-instance data for a UI glyph quad: a clip-space rect (4 × f32), the atlas
 * UV rect (4 × f32), the MSDF `unitRange` (2 × f32), and a packed RGBA color
 * (1 × u32, `unorm8x4`). 11 4-byte slots = 44 bytes.
 */
export const UI_GLYPH_FLOAT_COUNT = 11;

/** Byte size of one packed UI glyph instance. */
export const UI_GLYPH_BYTE_SIZE = UI_GLYPH_FLOAT_COUNT * 4;

/**
 * Write one glyph instance into the interleaved scratch views at `floatCursor`
 * (a slot index): clip rect, then atlas UV rect, then `unitRange`, then the
 * packed color. Re-uses {@link import('./ui-instance').packUiColor} for the color.
 */
export const packUiGlyph = (
  clipLeft: number,
  clipTop: number,
  clipRight: number,
  clipBottom: number,
  u0: number,
  v0: number,
  u1: number,
  v1: number,
  unitRangeX: number,
  unitRangeY: number,
  packedColor: number,
  f32: Float32Array,
  u32: Uint32Array,
  floatCursor: number,
): void => {
  f32[floatCursor] = clipLeft;
  f32[floatCursor + 1] = clipTop;
  f32[floatCursor + 2] = clipRight;
  f32[floatCursor + 3] = clipBottom;
  f32[floatCursor + 4] = u0;
  f32[floatCursor + 5] = v0;
  f32[floatCursor + 6] = u1;
  f32[floatCursor + 7] = v1;
  f32[floatCursor + 8] = unitRangeX;
  f32[floatCursor + 9] = unitRangeY;
  u32[floatCursor + 10] = packedColor;
};
