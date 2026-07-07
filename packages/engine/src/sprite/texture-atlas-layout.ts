import type { Vec2 } from '@retro-engine/math';
import { vec2 } from '@retro-engine/math';

import { Rect } from './sprite';

/**
 * Options for {@link TextureAtlasLayout.fromGrid}.
 *
 * All measurements are in **source-image pixels**; the constructor normalises
 * to UV space once at build time.
 */
export interface TextureAtlasFromGridOptions {
  /** Tile dimensions in source pixels. Both components must be positive. */
  tileSize: Vec2;
  /** Number of tile columns. Must be a positive integer. */
  columns: number;
  /** Number of tile rows. Must be a positive integer. */
  rows: number;
  /**
   * Inter-tile padding (gap between adjacent tiles), in source pixels.
   * Default `(0, 0)`. The padded gap is not represented as a tile — only the
   * `columns × rows` tile rects are emitted.
   */
  padding?: Vec2;
  /** Margin from the source image's top-left to the first tile, in source pixels. Default `(0, 0)`. */
  offset?: Vec2;
}

/**
 * A hand-placed sub-rectangle in **source-image pixels**, for
 * {@link TextureAtlasLayout.fromRects} — the manual counterpart to a grid tile.
 * `(x, y)` is the top-left corner; `width` / `height` extend right / down.
 */
export interface TextureAtlasRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Options for {@link TextureAtlasLayout.fromRects}. Pixels; normalised once at build time. */
export interface TextureAtlasFromRectsOptions {
  /** Source-image dimensions in pixels. Both components must be positive. */
  size: Vec2;
  /** Hand-authored sub-rects in source pixels, in the order sprites should index them. */
  rects: readonly TextureAtlasRect[];
}

/**
 * CPU-side layout asset: a source-image size plus a list of sub-rectangles
 * carving the image into named cells, each rect stored in **normalised UV
 * space** (`[0, 1]` on both axes — the same shape {@link Sprite.rect} accepts).
 *
 * A {@link TextureAtlas} component on an entity names which rect to render
 * this frame; the engine's `atlas-sync` system writes `sprite.rect =
 * layout.textures[atlas.index]` once per frame. Storing rects in normalised UV
 * makes this a zero-conversion write — `packSpriteInstance` consumes the rect
 * verbatim.
 *
 * Reusable across multiple images of the same grid shape — two character
 * sheets with identical 16×16 tiles share one layout asset. Build from a
 * regular grid with {@link TextureAtlasLayout.fromGrid}; pass a hand-authored
 * `Rect[]` to the constructor for sparse / non-grid carvings.
 *
 * Per-tile pixel size is derivable from the layout alone: for any rect `r`,
 * `pixelSize = vec2(size.x * (r.max.x - r.min.x), size.y * (r.max.y - r.min.y))`.
 * The engine's sprite bounds system uses this expression to size an entity's
 * `Aabb` when no `customSize` is set.
 *
 * Pre-asset-system shape: when `@retro-engine/assets` lands, `TextureAtlasLayout`
 * folds into a typed asset with a `Handle<TextureAtlasLayout>` indirection;
 * the class shape is the same in both worlds.
 *
 * @example
 * ```ts
 * // 4×4 grid of 16-pixel tiles on a 64×64 source.
 * const layout = TextureAtlasLayout.fromGrid({
 *   tileSize: vec2.create(16, 16),
 *   columns: 4,
 *   rows: 4,
 * });
 * const handle = world.getResource(TextureAtlasLayouts)!.add(layout);
 * cmd.spawn(new Sprite({ image }), new TextureAtlas(handle, 5));
 * ```
 */
export class TextureAtlasLayout {
  /** Source-image dimensions in pixels. */
  readonly size: Vec2;
  /**
   * Sub-rects carving the source image, in normalised UV space. Indexed
   * directly by {@link TextureAtlas.index}. Order is layout-defined — for
   * {@link TextureAtlasLayout.fromGrid} it is row-major
   * (`index = row * columns + col`).
   */
  readonly textures: Rect[];

  constructor(size: Vec2, textures: Rect[]) {
    this.size = size;
    this.textures = textures;
  }

  /**
   * Build a layout from a regular grid of tiles.
   *
   * The source image's pixel dimensions are derived from the grid:
   * `size = offset + columns * tileSize + (columns - 1) * padding` along X,
   * and analogously along Y. The image bytes themselves are not represented
   * here — only the geometry that carves them.
   *
   * Tile rects are stored in normalised UV, computed once: for column `c` and
   * row `r`,
   * `minPx = offset + c * (tileSize + padding)` (per-axis),
   * `maxPx = minPx + tileSize`, then divided by `size` to normalise.
   *
   * Row-major order: `textures[row * columns + col]`.
   */
  static fromGrid(opts: TextureAtlasFromGridOptions): TextureAtlasLayout {
    const tileW = opts.tileSize[0] as number;
    const tileH = opts.tileSize[1] as number;
    const cols = opts.columns;
    const rows = opts.rows;
    if (!Number.isInteger(cols) || cols <= 0) {
      throw new Error(`TextureAtlasLayout.fromGrid: columns must be a positive integer; got ${cols}.`);
    }
    if (!Number.isInteger(rows) || rows <= 0) {
      throw new Error(`TextureAtlasLayout.fromGrid: rows must be a positive integer; got ${rows}.`);
    }
    if (!(tileW > 0) || !(tileH > 0)) {
      throw new Error(
        `TextureAtlasLayout.fromGrid: tileSize components must be positive; got (${tileW}, ${tileH}).`,
      );
    }
    const padX = opts.padding !== undefined ? (opts.padding[0] as number) : 0;
    const padY = opts.padding !== undefined ? (opts.padding[1] as number) : 0;
    const offX = opts.offset !== undefined ? (opts.offset[0] as number) : 0;
    const offY = opts.offset !== undefined ? (opts.offset[1] as number) : 0;

    const sizeX = offX + cols * tileW + (cols - 1) * padX;
    const sizeY = offY + rows * tileH + (rows - 1) * padY;
    const size = vec2.create(sizeX, sizeY);

    const textures: Rect[] = [];
    for (let r = 0; r < rows; r += 1) {
      const minPxY = offY + r * (tileH + padY);
      const maxPxY = minPxY + tileH;
      const minVy = minPxY / sizeY;
      const maxVy = maxPxY / sizeY;
      for (let c = 0; c < cols; c += 1) {
        const minPxX = offX + c * (tileW + padX);
        const maxPxX = minPxX + tileW;
        const minUx = minPxX / sizeX;
        const maxUx = maxPxX / sizeX;
        textures[r * cols + c] = new Rect(
          vec2.create(minUx, minVy),
          vec2.create(maxUx, maxVy),
        );
      }
    }
    return new TextureAtlasLayout(size, textures);
  }

  /**
   * Build a layout from hand-authored pixel rects (Unity-style "multiple" sprite
   * mode — irregularly placed sprites on one sheet). Each rect is normalised to
   * UV against `size`, preserving order so `TextureAtlas.index` maps to
   * `rects[index]`. The manual counterpart to {@link TextureAtlasLayout.fromGrid}.
   *
   * Throws if `size` is non-positive or any rect has a non-positive dimension.
   * Rects are not bounds-clamped to the image — an out-of-bounds rect normalises
   * past `[0, 1]` (an authoring error the slicer surfaces rather than hides).
   */
  static fromRects(opts: TextureAtlasFromRectsOptions): TextureAtlasLayout {
    const sizeX = opts.size[0] as number;
    const sizeY = opts.size[1] as number;
    if (!(sizeX > 0) || !(sizeY > 0)) {
      throw new Error(`TextureAtlasLayout.fromRects: size components must be positive; got (${sizeX}, ${sizeY}).`);
    }
    const textures = opts.rects.map((r, i) => {
      if (!(r.width > 0) || !(r.height > 0)) {
        throw new Error(
          `TextureAtlasLayout.fromRects: rect #${i} must have positive width/height; got (${r.width}, ${r.height}).`,
        );
      }
      return new Rect(
        vec2.create(r.x / sizeX, r.y / sizeY),
        vec2.create((r.x + r.width) / sizeX, (r.y + r.height) / sizeY),
      );
    });
    return new TextureAtlasLayout(vec2.create(sizeX, sizeY), textures);
  }
}
