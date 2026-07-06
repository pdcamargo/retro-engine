import type { MsdfFont } from './font';

/** Horizontal alignment of wrapped/multi-line text within its block. */
export type TextAlign = 'left' | 'center' | 'right';

/** Options controlling how {@link layoutText} shapes a string. */
export interface TextLayoutOptions {
  /** Rendered em height, in pixels. Required — it sets the scale for everything. */
  fontSize: number;
  /**
   * Distance between baselines, in pixels. Defaults to the font's own
   * `lineHeight` scaled to {@link fontSize}.
   */
  lineHeight?: number;
  /**
   * Wrap width in pixels. When set, text greedily wraps at spaces to stay
   * within it (a single word longer than the width still overflows its line
   * rather than being split). When omitted, only explicit `\n` breaks lines.
   */
  maxWidth?: number;
  /** Horizontal alignment of each line within the block. Defaults to `'left'`. */
  align?: TextAlign;
  /** Extra spacing added after every glyph, in pixels. Defaults to `0`. */
  letterSpacing?: number;
}

/**
 * One positioned, drawable glyph quad in the text block's local space: origin at
 * the top-left of the block, x growing right, y growing down (pixels). The UV
 * rectangle is normalized (0..1) into the atlas texture with v = 0 at the top,
 * ready for the standard 2D quad path regardless of the atlas y-origin.
 */
export interface PositionedGlyph {
  /** Codepoint this quad renders. */
  readonly codepoint: number;
  /** Left edge of the quad, in block-local pixels. */
  readonly x: number;
  /** Top edge of the quad, in block-local pixels. */
  readonly y: number;
  /** Quad width in pixels. */
  readonly width: number;
  /** Quad height in pixels. */
  readonly height: number;
  /** Left UV (normalized). */
  readonly u0: number;
  /** Top UV (normalized). */
  readonly v0: number;
  /** Right UV (normalized). */
  readonly u1: number;
  /** Bottom UV (normalized). */
  readonly v1: number;
  /** Zero-based index of the line this glyph sits on. */
  readonly line: number;
}

/** Result of shaping a string: drawable glyph quads plus block bounds. */
export interface TextLayout {
  /** Visible glyph quads, in reading order. Whitespace produces no entry. */
  readonly glyphs: PositionedGlyph[];
  /** Natural content width (widest line), in pixels. */
  readonly width: number;
  /** Block height (`lineCount * lineHeight`), in pixels. */
  readonly height: number;
  /** Number of lines after wrapping. */
  readonly lineCount: number;
}

/** Just the measured bounds of a string, without producing glyph quads. */
export interface TextMeasure {
  /** Natural content width (widest line), in pixels. */
  readonly width: number;
  /** Block height (`lineCount * lineHeight`), in pixels. */
  readonly height: number;
  /** Number of lines after wrapping. */
  readonly lineCount: number;
}

interface ResolvedOptions {
  scale: number;
  lineHeightPx: number;
  maxWidth: number | undefined;
  align: TextAlign;
  letterSpacing: number;
}

function resolveOptions(font: MsdfFont, options: TextLayoutOptions): ResolvedOptions {
  const emSize = font.metrics.emSize || 1;
  const scale = options.fontSize / emSize;
  return {
    scale,
    lineHeightPx: options.lineHeight ?? font.metrics.lineHeight * scale,
    maxWidth: options.maxWidth,
    align: options.align ?? 'left',
    letterSpacing: options.letterSpacing ?? 0,
  };
}

/** Advance width of a run of codepoints (kerning + advances + letter spacing). */
function measureRun(font: MsdfFont, codepoints: number[], opts: ResolvedOptions): number {
  let width = 0;
  let prev: number | null = null;
  for (const cp of codepoints) {
    const g = font.glyph(cp);
    const advance = (g?.advance ?? 0) * opts.scale;
    const kern = prev !== null ? font.kerning(prev, cp) * opts.scale : 0;
    width += kern + advance + opts.letterSpacing;
    prev = cp;
  }
  return width;
}

/** Split a hard line (no `\n`) into greedy-wrapped visual lines of codepoints. */
function wrapHardLine(font: MsdfFont, line: string, opts: ResolvedOptions): number[][] {
  const codepoints = Array.from(line, (ch) => ch.codePointAt(0) ?? 0);
  if (opts.maxWidth === undefined) {
    return [codepoints];
  }

  const spaceCp = 0x20;
  const spaceAdvance = (font.glyph(spaceCp)?.advance ?? 0) * opts.scale + opts.letterSpacing;

  // Break into words on ASCII spaces; runs of spaces collapse to single gaps.
  const words: number[][] = [];
  let word: number[] = [];
  for (const cp of codepoints) {
    if (cp === spaceCp) {
      if (word.length > 0) {
        words.push(word);
        word = [];
      }
    } else {
      word.push(cp);
    }
  }
  if (word.length > 0) words.push(word);
  if (words.length === 0) return [[]];

  const lines: number[][] = [];
  let current: number[] = [];
  let currentWidth = 0;
  for (const w of words) {
    const wordWidth = measureRun(font, w, opts);
    if (current.length === 0) {
      current = [...w];
      currentWidth = wordWidth;
    } else if (currentWidth + spaceAdvance + wordWidth > opts.maxWidth) {
      lines.push(current);
      current = [...w];
      currentWidth = wordWidth;
    } else {
      current.push(spaceCp, ...w);
      currentWidth += spaceAdvance + wordWidth;
    }
  }
  lines.push(current);
  return lines;
}

/** Split source text on explicit newlines, then greedy-wrap each hard line. */
function computeLines(font: MsdfFont, text: string, opts: ResolvedOptions): number[][] {
  const lines: number[][] = [];
  for (const hard of text.split('\n')) {
    for (const visual of wrapHardLine(font, hard, opts)) {
      lines.push(visual);
    }
  }
  return lines;
}

/** Normalize a glyph's atlas rect into top-left-origin UVs for the 2D path. */
function glyphUv(
  font: MsdfFont,
  atlas: { left: number; bottom: number; right: number; top: number },
): { u0: number; v0: number; u1: number; v1: number } {
  const u0 = atlas.left / font.atlasWidth;
  const u1 = atlas.right / font.atlasWidth;
  if (font.yOrigin === 'top') {
    return { u0, v0: atlas.top / font.atlasHeight, u1, v1: atlas.bottom / font.atlasHeight };
  }
  // Default (bottom origin): flip so v = 0 is the top of the texture.
  return {
    u0,
    v0: 1 - atlas.top / font.atlasHeight,
    u1,
    v1: 1 - atlas.bottom / font.atlasHeight,
  };
}

/**
 * Shape a string into positioned glyph quads. Coordinates are in the text
 * block's local space (origin top-left, y down). Honors font size, line height,
 * explicit `\n`, greedy word wrap at {@link TextLayoutOptions.maxWidth}, and
 * horizontal alignment. The heavy inner loop of anything that draws text — keep
 * it allocation-lean.
 */
export function layoutText(font: MsdfFont, text: string, options: TextLayoutOptions): TextLayout {
  const opts = resolveOptions(font, options);
  const lines = computeLines(font, text, opts);
  const ascentPx = font.metrics.ascender * opts.scale;

  const lineWidths = lines.map((line) => measureRun(font, line, opts));
  const contentWidth = lineWidths.reduce((max, w) => Math.max(max, w), 0);
  const alignWidth = opts.maxWidth ?? contentWidth;

  const glyphs: PositionedGlyph[] = [];
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex] ?? [];
    const lineWidth = lineWidths[lineIndex] ?? 0;
    const baselineY = ascentPx + lineIndex * opts.lineHeightPx;

    let originX = 0;
    if (opts.align === 'center') originX = (alignWidth - lineWidth) / 2;
    else if (opts.align === 'right') originX = alignWidth - lineWidth;

    let penX = originX;
    let prev: number | null = null;
    for (const cp of line) {
      const g = font.glyph(cp);
      if (prev !== null) penX += font.kerning(prev, cp) * opts.scale;
      if (g?.plane && g.atlas) {
        const left = penX + g.plane.left * opts.scale;
        const right = penX + g.plane.right * opts.scale;
        const top = baselineY - g.plane.top * opts.scale;
        const bottom = baselineY - g.plane.bottom * opts.scale;
        const uv = glyphUv(font, g.atlas);
        glyphs.push({
          codepoint: cp,
          x: left,
          y: top,
          width: right - left,
          height: bottom - top,
          u0: uv.u0,
          v0: uv.v0,
          u1: uv.u1,
          v1: uv.v1,
          line: lineIndex,
        });
      }
      penX += (g?.advance ?? 0) * opts.scale + opts.letterSpacing;
      prev = cp;
    }
  }

  return {
    glyphs,
    width: contentWidth,
    height: lines.length * opts.lineHeightPx,
    lineCount: lines.length,
  };
}

/**
 * Measure a string's block bounds without producing glyph quads. Same wrapping
 * and metrics as {@link layoutText}; the cheap path the UI layout pass calls to
 * size a text node.
 */
export function measureText(
  font: MsdfFont,
  text: string,
  options: TextLayoutOptions,
): TextMeasure {
  const opts = resolveOptions(font, options);
  const lines = computeLines(font, text, opts);
  let width = 0;
  for (const line of lines) width = Math.max(width, measureRun(font, line, opts));
  return { width, height: lines.length * opts.lineHeightPx, lineCount: lines.length };
}
