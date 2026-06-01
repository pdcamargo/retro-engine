import type { Vec4 } from '@retro-engine/math';
import type { SamplerDescriptor, TextureFormat } from '@retro-engine/renderer-core';

/**
 * Texture dimension authored on an {@link Image}. WebGPU's `1d` is intentionally
 * not exposed here — no engine consumer needs it and excluding it keeps the
 * value-class surface small.
 *
 * Cube images carry six faces packed in array-layer order `+X, -X, +Y, -Y,
 * +Z, -Z`. The HAL stores them as a `dimension: '2d'` texture with
 * `depthOrArrayLayers: 6`; the schema walker validates against the authored
 * `dimension` (cube vs 2d) when binding.
 */
export type ImageDimension = '2d' | '3d' | 'cube';

/**
 * Color-space interpretation of an {@link Image}'s pixel bytes.
 *
 * - `'srgb'` — bytes are sRGB-encoded (the common case for color textures:
 *   base color, emissive, UI sprites, anything that came out of a paint tool
 *   or a `.png`). The GPU view is allocated with the matching `-srgb` format,
 *   so `textureSample` returns linear values.
 * - `'linear'` — bytes are linear data (normal maps, metallic / roughness /
 *   AO maps, displacement, atlas-layout LUTs, anything that encodes a number
 *   rather than a perceived color). The GPU view keeps the base format and
 *   `textureSample` returns the raw value with no transfer function applied.
 *
 * Mirrors Bevy's `Image::is_srgb` switch; defaults to `'srgb'` because the
 * common case for an authored 2D / 3D asset is a color texture.
 */
export type ImageColorSpace = 'srgb' | 'linear';

/**
 * CPU-side texture asset.
 *
 * Holds the raw pixel bytes plus the metadata the renderer needs to provision
 * a `Texture`, a default `TextureView`, and an attached `Sampler`. Authored
 * via {@link Image.solid} / {@link Image.checker} / {@link Image.fromBytes};
 * consumers register it through the {@link Images} registry to receive a
 * `Handle<Image>` that materials reference at bind time.
 *
 * **Shadow warning.** The class name `Image` shadows the DOM
 * `HTMLImageElement` constructor when imported from `@retro-engine/engine`.
 * Use `window.Image` (or the global at runtime) if you need the DOM one in
 * the same file.
 *
 * Pre-asset-system shape: when `@retro-engine/assets` lands, `Image` becomes a
 * typed asset with a `Handle<Image>` indirection; the field shape is the same
 * in both worlds.
 */
export class Image {
  /** Raw pixel bytes. For multi-layer images, layers are packed contiguously. */
  readonly data: Uint8Array;
  /**
   * Base texel format. Sampled formats only — depth formats are rejected at
   * upload. The sRGB-encoded view is selected by {@link Image.colorSpace};
   * `format` itself stays in the base form so the upload byte layout, the
   * `bytesPerTexel` query, and downstream format checks all key off one
   * value.
   */
  readonly format: TextureFormat;
  /**
   * Whether the pixel bytes are sRGB-encoded color or linear data.
   *
   * Consumers writing data textures (normal maps, metallic / roughness / AO,
   * displacement, atlas-layout LUTs) must pass `'linear'` explicitly; the
   * factory methods default to `'srgb'` because the common authored case is
   * a color texture.
   */
  readonly colorSpace: ImageColorSpace;
  readonly width: number;
  readonly height: number;
  /** Array-layer count (`6` for cube) or 3D depth. Defaults to `1`. */
  readonly depthOrArrayLayers: number;
  readonly dimension: ImageDimension;
  /** Sampler the image is bound through. Each image carries its own filter / wrap settings. */
  readonly sampler: SamplerDescriptor;
  /**
   * Mip levels packed into `data`. Phase 7.5 supports `1` only; the
   * {@link ImagePlugin} prepare system throws on `> 1`. The field stays so a
   * future phase can flip the support on without a type change.
   */
  readonly mipLevelCount: number;
  readonly label?: string;

  constructor(init: {
    data: Uint8Array;
    format: TextureFormat;
    colorSpace?: ImageColorSpace;
    width: number;
    height: number;
    depthOrArrayLayers?: number;
    dimension?: ImageDimension;
    sampler?: SamplerDescriptor;
    mipLevelCount?: number;
    label?: string;
  }) {
    this.data = init.data;
    this.format = init.format;
    this.colorSpace = init.colorSpace ?? 'srgb';
    this.width = init.width;
    this.height = init.height;
    this.depthOrArrayLayers = init.depthOrArrayLayers ?? 1;
    this.dimension = init.dimension ?? '2d';
    this.sampler = init.sampler ?? DEFAULT_LINEAR_SAMPLER;
    this.mipLevelCount = init.mipLevelCount ?? 1;
    if (init.label !== undefined) this.label = init.label;
  }

  /**
   * Build a 1×1 RGBA8 image filled with one solid colour. Components are
   * clamped to `[0, 1]` and rounded to the nearest byte. Default sampler is
   * linear in both directions; pass `sampler` to override.
   *
   * Useful for default-fallback handles (`Images.WHITE`, `.BLACK`,
   * `.NORMAL_FLAT`) and for materials that take a tint colour without a
   * texture. Default color space is `'srgb'` — pass `colorSpace: 'linear'`
   * for data textures (e.g. a flat normal `(0.5, 0.5, 1, 1)`).
   */
  static solid(rgba: Vec4, opts?: ImageFactoryOptions): Image {
    const data = new Uint8Array(4);
    data[0] = toByte(rgba[0]!);
    data[1] = toByte(rgba[1]!);
    data[2] = toByte(rgba[2]!);
    data[3] = toByte(rgba[3]!);
    return new Image({
      data,
      format: 'rgba8unorm',
      colorSpace: opts?.colorSpace ?? 'srgb',
      width: 1,
      height: 1,
      ...(opts?.sampler !== undefined ? { sampler: opts.sampler } : {}),
      ...(opts?.label !== undefined ? { label: opts.label } : {}),
    });
  }

  /**
   * Build a `size × size` RGBA8 checker pattern alternating between `a` and
   * `b`. Mostly a debug aid — drop one into a material to see how UVs map
   * across geometry. Default sampler is nearest in both directions so the
   * checks stay crisp.
   *
   * `size` must be a positive integer.
   *
   * Default color space is `'srgb'` — pass `colorSpace: 'linear'` to author
   * the checker as data (e.g. for an alpha mask or a debug UV grid sampled
   * without color decode).
   */
  static checker(size: number, a: Vec4, b: Vec4, opts?: ImageFactoryOptions): Image {
    if (!Number.isInteger(size) || size <= 0) {
      throw new Error(`Image.checker: size must be a positive integer; got ${size}.`);
    }
    const data = new Uint8Array(size * size * 4);
    const aR = toByte(a[0]!);
    const aG = toByte(a[1]!);
    const aB = toByte(a[2]!);
    const aA = toByte(a[3]!);
    const bR = toByte(b[0]!);
    const bG = toByte(b[1]!);
    const bB = toByte(b[2]!);
    const bA = toByte(b[3]!);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const useA = ((x + y) & 1) === 0;
        const i = (y * size + x) * 4;
        data[i] = useA ? aR : bR;
        data[i + 1] = useA ? aG : bG;
        data[i + 2] = useA ? aB : bB;
        data[i + 3] = useA ? aA : bA;
      }
    }
    return new Image({
      data,
      format: 'rgba8unorm',
      colorSpace: opts?.colorSpace ?? 'srgb',
      width: size,
      height: size,
      sampler: opts?.sampler ?? { magFilter: 'nearest', minFilter: 'nearest' },
      ...(opts?.label !== undefined ? { label: opts.label } : {}),
    });
  }

  /**
   * General-purpose constructor for an authored byte buffer. Validates that
   * `data.length` matches `width × height × layers × bytesPerTexel(format)`,
   * throwing on mismatch.
   *
   * `format` must be a base format — pass the sRGB-vs-linear choice through
   * `colorSpace` (defaults to `'srgb'`). Passing an explicit `-srgb` format
   * is rejected; the upload layer applies the variant from `colorSpace`.
   */
  static fromBytes(init: {
    data: Uint8Array;
    format: TextureFormat;
    colorSpace?: ImageColorSpace;
    width: number;
    height: number;
    depthOrArrayLayers?: number;
    dimension?: ImageDimension;
    sampler?: SamplerDescriptor;
    mipLevelCount?: number;
    label?: string;
  }): Image {
    if (init.format === 'rgba8unorm-srgb' || init.format === 'bgra8unorm-srgb') {
      throw new Error(
        `Image.fromBytes: pass a base format (e.g. '${init.format.replace('-srgb', '')}') and colorSpace: 'srgb' rather than the -srgb format directly.`,
      );
    }
    const layers = init.depthOrArrayLayers ?? 1;
    const dimension = init.dimension ?? '2d';
    if (dimension === 'cube' && layers !== 6) {
      throw new Error(
        `Image.fromBytes: cube images require depthOrArrayLayers=6; got ${layers}.`,
      );
    }
    const bpt = bytesPerTexel(init.format);
    if (bpt === undefined) {
      throw new Error(
        `Image.fromBytes: format '${init.format}' is not a sampled colour format supported by Image.`,
      );
    }
    const expected = init.width * init.height * layers * bpt;
    if (init.data.byteLength !== expected) {
      throw new Error(
        `Image.fromBytes: data byteLength ${init.data.byteLength} does not match width(${init.width}) * height(${init.height}) * layers(${layers}) * bytesPerTexel(${bpt}) = ${expected}.`,
      );
    }
    return new Image(init);
  }
}

/**
 * Shared option bag for {@link Image.solid} and {@link Image.checker}.
 */
export interface ImageFactoryOptions {
  readonly sampler?: SamplerDescriptor;
  readonly label?: string;
  readonly colorSpace?: ImageColorSpace;
}

const DEFAULT_LINEAR_SAMPLER: SamplerDescriptor = Object.freeze({
  magFilter: 'linear',
  minFilter: 'linear',
});

const toByte = (v: number): number => {
  if (v <= 0) return 0;
  if (v >= 1) return 255;
  return Math.round(v * 255);
};

/**
 * Bytes per texel for the colour formats the Image asset supports. Returns
 * `undefined` for depth/stencil formats and any other format that can't be a
 * `TEXTURE_BINDING` source. Exported so `ImagePlugin`'s prepare system can
 * compute `bytesPerRow` for `writeTexture` without re-deriving it.
 *
 * sRGB variants share the byte width of their base form (one byte per
 * channel, four channels) — the difference is the sampling / store transfer
 * function, not the storage layout.
 */
export const bytesPerTexel = (format: TextureFormat): number | undefined => {
  switch (format) {
    case 'r8unorm':
      return 1;
    case 'rgba8unorm':
    case 'rgba8unorm-srgb':
    case 'bgra8unorm':
    case 'bgra8unorm-srgb':
    case 'rg16float':
      return 4;
    case 'rgba16float':
      return 8;
    default:
      return undefined;
  }
};
