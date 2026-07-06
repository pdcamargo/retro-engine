/**
 * Per-instance data for a UI image quad: a clip-space rect (4 × f32), the source
 * UV rect (4 × f32), and a packed RGBA tint (1 × u32, `unorm8x4`). 9 4-byte slots
 * = 36 bytes.
 */
export const UI_IMAGE_FLOAT_COUNT = 9;

/** Byte size of one packed UI image instance. */
export const UI_IMAGE_BYTE_SIZE = UI_IMAGE_FLOAT_COUNT * 4;

/**
 * Write one image instance into the interleaved scratch views at `floatCursor`
 * (a slot index): clip rect, then source UV rect, then the packed tint. Re-uses
 * {@link import('./ui-instance').packUiColor} for the tint.
 */
export const packUiImage = (
  clipLeft: number,
  clipTop: number,
  clipRight: number,
  clipBottom: number,
  u0: number,
  v0: number,
  u1: number,
  v1: number,
  packedTint: number,
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
  u32[floatCursor + 8] = packedTint;
};
