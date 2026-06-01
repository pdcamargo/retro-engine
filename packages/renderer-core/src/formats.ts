/**
 * Texture / surface formats the HAL recognises.
 *
 * Expand as the engine needs them — every value added here must be mappable to
 * a concrete pixel format in every backend that ships.
 *
 * The `-srgb` variants of `rgba8unorm` / `bgra8unorm` carry the same byte
 * layout as their base form; the difference is the GPU sampling / storing
 * transfer function. A `-srgb` view performs `sRGB → linear` on
 * `textureSample` and `linear → sRGB` on render-target store. Pair with
 * {@link srgbVariantOf} when promoting a base format to its sRGB-encoding
 * sibling for a texture view or pipeline color target.
 */
export type TextureFormat =
  | 'rgba8unorm'
  | 'rgba8unorm-srgb'
  | 'bgra8unorm'
  | 'bgra8unorm-srgb'
  | 'r8unorm'
  | 'rg16float'
  | 'rgba16float'
  | 'depth32float'
  | 'depth24plus'
  | 'depth24plus-stencil8';

/**
 * Promote a {@link TextureFormat} to its `-srgb` sibling for sRGB-encoding
 * texture views and pipeline color targets.
 *
 * - `'rgba8unorm'` / `'rgba8unorm-srgb'` → `'rgba8unorm-srgb'`
 * - `'bgra8unorm'` / `'bgra8unorm-srgb'` → `'bgra8unorm-srgb'`
 * - any other format → returned unchanged (no sRGB sibling exists; HDR float
 *   formats and depth formats are linear by definition).
 *
 * Idempotent — passing an already-sRGB format returns it as-is.
 */
export const srgbVariantOf = (format: TextureFormat): TextureFormat => {
  switch (format) {
    case 'rgba8unorm':
    case 'rgba8unorm-srgb':
      return 'rgba8unorm-srgb';
    case 'bgra8unorm':
    case 'bgra8unorm-srgb':
      return 'bgra8unorm-srgb';
    default:
      return format;
  }
};

/**
 * RGBA clear / fill color, components in `[0, 1]`.
 *
 * Mirrors WebGPU's `GPUColorDict` so backends can pass it straight through.
 */
export interface ClearColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

/**
 * Per-vertex attribute byte format.
 *
 * The string values mirror WebGPU's `GPUVertexFormat` exactly so the WebGPU
 * backend can pass them through unmodified. Other backends translate to their
 * own model — `Float32x3` becomes a `GL_FLOAT` vec3 attribute on WebGL2,
 * `Unorm8x4` becomes a normalised `GL_UNSIGNED_BYTE` vec4, and so on.
 *
 * Use {@link vertexFormatByteSize} to query the per-vertex size of one
 * attribute in bytes.
 */
export type VertexFormat =
  | 'uint8x2'
  | 'uint8x4'
  | 'sint8x2'
  | 'sint8x4'
  | 'unorm8x2'
  | 'unorm8x4'
  | 'snorm8x2'
  | 'snorm8x4'
  | 'uint16x2'
  | 'uint16x4'
  | 'sint16x2'
  | 'sint16x4'
  | 'unorm16x2'
  | 'unorm16x4'
  | 'snorm16x2'
  | 'snorm16x4'
  | 'float16x2'
  | 'float16x4'
  | 'float32'
  | 'float32x2'
  | 'float32x3'
  | 'float32x4'
  | 'uint32'
  | 'uint32x2'
  | 'uint32x3'
  | 'uint32x4'
  | 'sint32'
  | 'sint32x2'
  | 'sint32x3'
  | 'sint32x4';

const VERTEX_FORMAT_BYTE_SIZES: Readonly<Record<VertexFormat, number>> = {
  uint8x2: 2,
  uint8x4: 4,
  sint8x2: 2,
  sint8x4: 4,
  unorm8x2: 2,
  unorm8x4: 4,
  snorm8x2: 2,
  snorm8x4: 4,
  uint16x2: 4,
  uint16x4: 8,
  sint16x2: 4,
  sint16x4: 8,
  unorm16x2: 4,
  unorm16x4: 8,
  snorm16x2: 4,
  snorm16x4: 8,
  float16x2: 4,
  float16x4: 8,
  float32: 4,
  float32x2: 8,
  float32x3: 12,
  float32x4: 16,
  uint32: 4,
  uint32x2: 8,
  uint32x3: 12,
  uint32x4: 16,
  sint32: 4,
  sint32x2: 8,
  sint32x3: 12,
  sint32x4: 16,
};

/**
 * Size in bytes of one occurrence of `format` in a vertex buffer.
 *
 * Used by vertex-layout builders to compute `arrayStride` and per-attribute
 * `offset` values when the layout is derived from a list of attributes rather
 * than declared by hand.
 */
export const vertexFormatByteSize = (format: VertexFormat): number => VERTEX_FORMAT_BYTE_SIZES[format];

/**
 * Width of one index value in a vertex-indexing buffer.
 *
 * `uint16` is the default for meshes with fewer than 65 536 vertices; `uint32`
 * is required above that. The string values mirror WebGPU's `GPUIndexFormat`.
 */
export type IndexFormat = 'uint16' | 'uint32';

/**
 * Size in bytes of one index value for the given {@link IndexFormat}.
 */
export const indexFormatByteSize = (format: IndexFormat): number => (format === 'uint16' ? 2 : 4);
