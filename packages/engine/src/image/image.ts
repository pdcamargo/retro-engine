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
 * CPU-side texture asset.
 *
 * Holds the raw pixel bytes plus the metadata the renderer needs to provision
 * a `Texture`, a default `TextureView`, and an attached `Sampler`. Authored
 * via {@link Image.solid} / {@link Image.checker} / {@link Image.fromBytes};
 * consumers register it through the {@link Images} registry to receive an
 * {@link ImageHandle} that materials reference at bind time.
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
  /** Texel format. Sampled formats only — depth formats are rejected at upload. */
  readonly format: TextureFormat;
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
   * linear in both directions; pass a {@link SamplerDescriptor} to override.
   *
   * Useful for default-fallback handles (`Images.WHITE`, `.BLACK`,
   * `.NORMAL_FLAT`) and for materials that take a tint colour without a
   * texture.
   */
  static solid(rgba: Vec4, sampler?: SamplerDescriptor, label?: string): Image {
    const data = new Uint8Array(4);
    data[0] = toByte(rgba[0]!);
    data[1] = toByte(rgba[1]!);
    data[2] = toByte(rgba[2]!);
    data[3] = toByte(rgba[3]!);
    return new Image({
      data,
      format: 'rgba8unorm',
      width: 1,
      height: 1,
      ...(sampler !== undefined ? { sampler } : {}),
      ...(label !== undefined ? { label } : {}),
    });
  }

  /**
   * Build a `size × size` RGBA8 checker pattern alternating between `a` and
   * `b`. Mostly a debug aid — drop one into a material to see how UVs map
   * across geometry. Default sampler is nearest in both directions so the
   * checks stay crisp.
   *
   * `size` must be a positive integer.
   */
  static checker(size: number, a: Vec4, b: Vec4, sampler?: SamplerDescriptor, label?: string): Image {
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
      width: size,
      height: size,
      sampler: sampler ?? { magFilter: 'nearest', minFilter: 'nearest' },
      ...(label !== undefined ? { label } : {}),
    });
  }

  /**
   * General-purpose constructor for an authored byte buffer. Validates that
   * `data.length` matches `width × height × layers × bytesPerTexel(format)`,
   * throwing on mismatch.
   */
  static fromBytes(init: {
    data: Uint8Array;
    format: TextureFormat;
    width: number;
    height: number;
    depthOrArrayLayers?: number;
    dimension?: ImageDimension;
    sampler?: SamplerDescriptor;
    mipLevelCount?: number;
    label?: string;
  }): Image {
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
 */
export const bytesPerTexel = (format: TextureFormat): number | undefined => {
  switch (format) {
    case 'rgba8unorm':
    case 'bgra8unorm':
      return 4;
    case 'rgba16float':
      return 8;
    default:
      return undefined;
  }
};
