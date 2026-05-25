/**
 * Inset thickness, in **source-image pixels**, used by {@link TextureSlicer}
 * to carve a sprite's source UV into nine sub-rects: four corners, four
 * edges, and a centre.
 *
 * `top` / `bottom` are measured from the upper / lower edge of the sprite's
 * source rectangle in the engine's Y-up convention. For an atlassed sprite,
 * the border units are still source-image pixels (i.e. atlas-image pixels) —
 * because the atlas image and any tile within it share the same pixel scale,
 * an `8`-pixel border carves an `8`-pixel inset from whichever tile a
 * {@link TextureAtlas} writes into `sprite.rect`.
 *
 * Use the {@link BorderRect.all} factory for symmetric borders; pass the
 * four-arg constructor for asymmetric layouts (e.g. a tooltip with a wider
 * left margin for the tail).
 *
 * @example
 * ```ts
 * // Uniform 8-pixel border on every side.
 * new TextureSlicer({ border: BorderRect.all(8) });
 *
 * // 4-pixel sides, 12-pixel top, 6-pixel bottom.
 * new TextureSlicer({ border: new BorderRect(4, 4, 12, 6) });
 * ```
 */
export class BorderRect {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;

  constructor(left: number, right: number, top: number, bottom: number) {
    this.left = left;
    this.right = right;
    this.top = top;
    this.bottom = bottom;
  }

  /** Symmetric border — same inset on all four sides. */
  static all(px: number): BorderRect {
    return new BorderRect(px, px, px, px);
  }
}

/**
 * How a {@link TextureSlicer} fills the edge and centre regions when the
 * sprite's destination footprint is larger than the source area inside its
 * border.
 *
 * Only `'stretch'` ships in this phase — the edges and centre stretch
 * linearly along their non-fixed axis to fill the destination. The type is
 * forward-compat: a future `'tile'` value would repeat the source region
 * across the destination instead of stretching it.
 */
export type SliceScaleMode = 'stretch';

/**
 * Constructor options for {@link TextureSlicer}.
 */
export interface TextureSlicerOptions {
  /** Source-pixel insets that carve the source UV into the nine sub-rects. */
  border: BorderRect;
  /** Fill behaviour for the centre region. Defaults to `'stretch'`. */
  centerScaleMode?: SliceScaleMode;
  /** Fill behaviour for the four edge regions. Defaults to `'stretch'`. */
  sidesScaleMode?: SliceScaleMode;
  /**
   * Maximum scale factor permitted for corner quads. Reserved for a future
   * "shrink the corners when the destination is smaller than the border sum"
   * mode; stored but not enforced in this phase. A consumer that hits the
   * degenerate "border exceeds footprint" case today should keep
   * `customSize` larger than `border.left + border.right` (and same on the
   * Y axis) — the sliced sprite renders correctly as long as the
   * destination fits the borders.
   */
  maxCornerScale?: number;
}

/**
 * Data class describing a 9-slice carving of a sprite's source image.
 *
 * The slicer's {@link border} fields are in source-image pixels; the
 * runtime divides four corner quads (fixed at the border's pixel size in
 * destination space), four edges (stretched along one axis), and one centre
 * (stretched along both axes) so a stretchable UI panel keeps crisp corners
 * regardless of how `Sprite.customSize` is scaled.
 *
 * Attach to a sprite via {@link SpriteImageMode}:
 *
 * ```ts
 * cmd.spawn(
 *   new Sprite({
 *     image: panelImage,
 *     customSize: vec2.create(320, 160),
 *     imageMode: {
 *       kind: 'sliced',
 *       slicer: new TextureSlicer({ border: BorderRect.all(8) }),
 *     },
 *   }),
 *   new Transform(...),
 * );
 * ```
 *
 * Composes with {@link TextureAtlas} and the animation ticker — the border
 * carves whichever per-frame UV sub-rect the atlas writes, so an atlassed
 * (or animated) sprite can be 9-sliced without any extra wiring.
 */
export class TextureSlicer {
  readonly border: BorderRect;
  readonly centerScaleMode: SliceScaleMode;
  readonly sidesScaleMode: SliceScaleMode;
  readonly maxCornerScale: number | undefined;

  constructor(options: TextureSlicerOptions) {
    this.border = options.border;
    this.centerScaleMode = options.centerScaleMode ?? 'stretch';
    this.sidesScaleMode = options.sidesScaleMode ?? 'stretch';
    this.maxCornerScale = options.maxCornerScale;
  }
}

/**
 * Discriminated union toggling between a single-quad sprite (the default)
 * and a {@link TextureSlicer}-driven nine-quad sprite.
 *
 * Stored as the optional `imageMode` field on `Sprite`. `undefined` and
 * `{ kind: 'auto' }` behave identically — the sprite renders as one quad.
 * Set `{ kind: 'sliced', slicer: … }` to turn the sprite into a stretchable
 * 9-slice panel; the renderer's pack hot-path branches on `kind` and emits
 * nine packed instances instead of one for that entity.
 *
 * The type is open to future variants: `'tiled'` (repeating the entire
 * source across the destination) and similar live behind their own
 * discriminant when consumers ask for them.
 */
export type SpriteImageMode =
  | { readonly kind: 'auto' }
  | { readonly kind: 'sliced'; readonly slicer: TextureSlicer };
