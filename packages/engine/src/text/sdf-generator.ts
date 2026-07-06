import { type FontMetrics, type GlyphMetrics, MsdfFont } from './font';

/** A line segment in glyph grid units: `[x0, y0, x1, y1]`. */
export type StrokeSegment = readonly [number, number, number, number];

/**
 * A stroke-defined glyph: its advance and the polyline segments that draw it,
 * all in grid units (baseline at y = 0, y up). A glyph with no segments (e.g.
 * space) contributes only its advance and gets no atlas cell.
 */
export interface StrokeGlyph {
  readonly codepoint: number;
  /** Horizontal advance in grid units. */
  readonly advance: number;
  /** Stroke polyline segments; empty for whitespace glyphs. */
  readonly segments: readonly StrokeSegment[];
}

/** Geometry + resolution controls for {@link generateSdfFont}. */
export interface SdfFontOptions {
  /** Design cell width in grid units (glyph ink space is `[0, cellWidth]`). */
  readonly cellWidth: number;
  /** Cap/ascent height above the baseline, in grid units. */
  readonly ascent: number;
  /** Descent below the baseline, in grid units (positive magnitude). */
  readonly descent: number;
  /** Grid units per em (normalizes advances/metrics into em space). */
  readonly emUnits: number;
  /** Stroke half-width in grid units (full stroke = `2 × strokeHalfWidth`). */
  readonly strokeHalfWidth: number;
  /** Atlas texels per grid unit — the rasterization resolution. */
  readonly pixelsPerUnit: number;
  /** Signed-distance range in texels (the `distanceRange` written to the font). */
  readonly distanceRange: number;
  /** Texel padding around every cell, so the distance spread is not clipped. */
  readonly padding: number;
  /** Extra line spacing beyond ascent + descent, in grid units. */
  readonly lineGap: number;
}

/** Distance from point `(px, py)` to segment `[ax, ay]–[bx, by]`. */
const distToSegment = (
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number => {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq > 0 ? ((px - ax) * dx + (py - ay) * dy) / lenSq : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  const ex = px - cx;
  const ey = py - cy;
  return Math.sqrt(ex * ex + ey * ey);
};

/**
 * Rasterize a set of {@link StrokeGlyph}s into a single-channel SDF atlas (stored
 * in all three RGB channels so the median-of-RGB MSDF shader reconstructs it),
 * returning the RGBA8 pixels plus the parsed {@link MsdfFont} metrics. Pure JS,
 * no native tools or DOM — a zero-dependency path to crisp, scalable text.
 *
 * Every drawn glyph shares a uniform cell (the full design box plus padding), so
 * packing and UV math stay simple; ink smaller than the cell is just background
 * (fully-outside) distance. Whitespace glyphs get an advance and no cell. The
 * atlas uses a top-left pixel origin (`yOrigin: 'top'`).
 */
export const generateSdfFont = (
  glyphs: readonly StrokeGlyph[],
  options: SdfFontOptions,
): { rgba: Uint8Array; width: number; height: number; font: MsdfFont } => {
  const { cellWidth, ascent, descent, emUnits, strokeHalfWidth, pixelsPerUnit, distanceRange, padding } =
    options;

  // Uniform cell in design (grid) units, expanded by padding converted to units.
  const padUnits = padding / pixelsPerUnit;
  const planeLeft = -padUnits;
  const planeRight = cellWidth + padUnits;
  const planeBottom = -descent - padUnits;
  const planeTop = ascent + padUnits;

  const cellWpx = Math.ceil((planeRight - planeLeft) * pixelsPerUnit);
  const cellHpx = Math.ceil((planeTop - planeBottom) * pixelsPerUnit);

  const drawn = glyphs.filter((g) => g.segments.length > 0);
  const columns = Math.max(1, Math.floor(Math.sqrt(drawn.length)) + 1);
  const rows = Math.ceil(drawn.length / columns);
  const width = columns * cellWpx;
  const height = Math.max(1, rows * cellHpx);
  const rgba = new Uint8Array(width * height * 4);
  // Opaque background: the shader samples RGB (median distance) only, but a
  // fully-opaque grayscale atlas is cleaner if ever inspected or exported. RGB
  // stays 0 (fully outside) until a glyph writes into its cell.
  for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;

  const glyphMap = new Map<number, GlyphMetrics>();

  // Whitespace / cell-less glyphs: advance only.
  for (const g of glyphs) {
    if (g.segments.length === 0) {
      glyphMap.set(g.codepoint, { codepoint: g.codepoint, advance: g.advance / emUnits });
    }
  }

  drawn.forEach((glyph, index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    const originX = col * cellWpx;
    const originY = row * cellHpx;

    for (let py = 0; py < cellHpx; py++) {
      // py = 0 is the top of the cell (highest design Y).
      const designY = planeTop - ((py + 0.5) / cellHpx) * (planeTop - planeBottom);
      for (let px = 0; px < cellWpx; px++) {
        const designX = planeLeft + ((px + 0.5) / cellWpx) * (planeRight - planeLeft);

        let minDist = Number.POSITIVE_INFINITY;
        for (const [ax, ay, bx, by] of glyph.segments) {
          const d = distToSegment(designX, designY, ax, ay, bx, by);
          if (d < minDist) minDist = d;
        }
        // Signed distance: positive inside the stroke. Encode msdfgen-style:
        // value 0.5 = edge, ±distanceRange/2 texels spans [0, 1].
        const sdTexels = (strokeHalfWidth - minDist) * pixelsPerUnit;
        let value = 0.5 + sdTexels / distanceRange;
        value = value < 0 ? 0 : value > 1 ? 1 : value;
        const byte = Math.round(value * 255);

        const offset = ((originY + py) * width + (originX + px)) * 4;
        rgba[offset] = byte;
        rgba[offset + 1] = byte;
        rgba[offset + 2] = byte;
        rgba[offset + 3] = 255;
      }
    }

    glyphMap.set(glyph.codepoint, {
      codepoint: glyph.codepoint,
      advance: glyph.advance / emUnits,
      plane: {
        left: planeLeft / emUnits,
        bottom: planeBottom / emUnits,
        right: planeRight / emUnits,
        top: planeTop / emUnits,
      },
      atlas: {
        left: originX,
        bottom: originY + cellHpx,
        right: originX + cellWpx,
        top: originY,
      },
    });
  });

  const metrics: FontMetrics = {
    emSize: 1,
    lineHeight: (ascent + descent + options.lineGap) / emUnits,
    ascender: ascent / emUnits,
    descender: -descent / emUnits,
  };

  const font = new MsdfFont({
    metrics,
    distanceRange,
    atlasWidth: width,
    atlasHeight: height,
    atlasType: 'sdf',
    yOrigin: 'top',
    glyphs: glyphMap,
  });

  return { rgba, width, height, font };
};
