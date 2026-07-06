/**
 * A rectangle in either em space (glyph plane bounds, relative to the pen /
 * baseline) or atlas-texture pixel space (glyph atlas bounds). All four edges
 * are absolute coordinates in their respective space.
 */
export interface GlyphRect {
  readonly left: number;
  readonly bottom: number;
  readonly right: number;
  readonly top: number;
}

/**
 * Per-glyph shaping and atlas data for a single codepoint, as produced by
 * `msdf-atlas-gen`. Whitespace glyphs carry only an {@link advance} and have no
 * {@link plane} / {@link atlas} rectangle (nothing is drawn).
 */
export interface GlyphMetrics {
  /** Unicode codepoint this glyph renders. */
  readonly codepoint: number;
  /** Horizontal pen advance after the glyph, in em (font units, emSize = 1). */
  readonly advance: number;
  /**
   * Quad bounds in em, relative to the pen origin (x) and baseline (y, up
   * positive). Absent for glyphs with no visible shape (e.g. space).
   */
  readonly plane?: GlyphRect;
  /**
   * Source rectangle in atlas-texture pixels. Absent for glyphs with no visible
   * shape. Paired with {@link plane}.
   */
  readonly atlas?: GlyphRect;
}

/**
 * Font-wide vertical metrics, in em (emSize = 1). Line spacing and baseline
 * placement derive from these.
 */
export interface FontMetrics {
  /** Size of one em in font units. Normalized to 1 by `msdf-atlas-gen`. */
  readonly emSize: number;
  /** Distance between consecutive baselines, in em. */
  readonly lineHeight: number;
  /** Height of the tallest glyphs above the baseline, in em (positive). */
  readonly ascender: number;
  /** Depth of the lowest glyphs below the baseline, in em (negative). */
  readonly descender: number;
  /** Vertical position of the underline relative to the baseline, in em. */
  readonly underlineY?: number;
  /** Thickness of the underline stroke, in em. */
  readonly underlineThickness?: number;
}

/** Vertical origin convention of the atlas image's pixel coordinates. */
export type AtlasYOrigin = 'bottom' | 'top';

/**
 * A parsed MSDF font: vertical metrics, per-codepoint glyph data, optional
 * kerning pairs, and the geometry of its companion atlas texture. Produced by
 * {@link parseMsdfFont} and consumed by the text layout engine; it holds no GPU
 * resources — the atlas image is loaded separately.
 */
export class MsdfFont {
  /** Font-wide vertical metrics. */
  readonly metrics: FontMetrics;
  /** Signed-distance range baked into the atlas, in texels. Drives the AA width. */
  readonly distanceRange: number;
  /** Atlas texture width in pixels. */
  readonly atlasWidth: number;
  /** Atlas texture height in pixels. */
  readonly atlasHeight: number;
  /** Field kind the atlas encodes (`'msdf'`, `'mtsdf'`, …). */
  readonly atlasType: string;
  /** Vertical origin of the atlas pixel coordinates. */
  readonly yOrigin: AtlasYOrigin;

  readonly #glyphs: ReadonlyMap<number, GlyphMetrics>;
  readonly #kerning: ReadonlyMap<string, number>;

  constructor(init: {
    metrics: FontMetrics;
    distanceRange: number;
    atlasWidth: number;
    atlasHeight: number;
    atlasType: string;
    yOrigin: AtlasYOrigin;
    glyphs: ReadonlyMap<number, GlyphMetrics>;
    kerning?: ReadonlyMap<string, number>;
  }) {
    this.metrics = init.metrics;
    this.distanceRange = init.distanceRange;
    this.atlasWidth = init.atlasWidth;
    this.atlasHeight = init.atlasHeight;
    this.atlasType = init.atlasType;
    this.yOrigin = init.yOrigin;
    this.#glyphs = init.glyphs;
    this.#kerning = init.kerning ?? new Map();
  }

  /** Glyph data for a codepoint, or `undefined` if the font has no such glyph. */
  glyph(codepoint: number): GlyphMetrics | undefined {
    return this.#glyphs.get(codepoint);
  }

  /** Whether the font contains a glyph for the codepoint. */
  hasGlyph(codepoint: number): boolean {
    return this.#glyphs.has(codepoint);
  }

  /**
   * Kerning adjustment applied to the advance between two consecutive
   * codepoints, in em. Returns `0` when the pair has no kerning entry.
   */
  kerning(left: number, right: number): number {
    return this.#kerning.get(kerningKey(left, right)) ?? 0;
  }

  /** Number of glyphs the font defines. */
  get glyphCount(): number {
    return this.#glyphs.size;
  }
}

/** Map key for a directed kerning pair. */
export function kerningKey(left: number, right: number): string {
  return `${left},${right}`;
}
