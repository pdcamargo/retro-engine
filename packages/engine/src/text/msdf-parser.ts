import {
  type AtlasYOrigin,
  type FontMetrics,
  type GlyphMetrics,
  type GlyphRect,
  kerningKey,
  MsdfFont,
} from './font';

/**
 * Raw shape of the JSON emitted by `msdf-atlas-gen` (`-json` output). Only the
 * fields the layout engine consumes are typed; unknown extras are ignored.
 */
export interface MsdfFontJson {
  atlas: {
    type: string;
    distanceRange: number;
    size: number;
    width: number;
    height: number;
    yOrigin?: string;
  };
  metrics: {
    emSize: number;
    lineHeight: number;
    ascender: number;
    descender: number;
    underlineY?: number;
    underlineThickness?: number;
  };
  glyphs: Array<{
    unicode: number;
    advance: number;
    planeBounds?: { left: number; bottom: number; right: number; top: number };
    atlasBounds?: { left: number; bottom: number; right: number; top: number };
  }>;
  kerning?: Array<{ unicode1: number; unicode2: number; advance: number }>;
}

function requireNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`parseMsdfFont: expected a finite number for "${field}", got ${String(value)}`);
  }
  return value;
}

function requireObject(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`parseMsdfFont: expected an object for "${field}"`);
  }
  return value as Record<string, unknown>;
}

function readRect(raw: unknown, field: string): GlyphRect {
  const r = requireObject(raw, field);
  return {
    left: requireNumber(r.left, `${field}.left`),
    bottom: requireNumber(r.bottom, `${field}.bottom`),
    right: requireNumber(r.right, `${field}.right`),
    top: requireNumber(r.top, `${field}.top`),
  };
}

/**
 * Parse the JSON produced by `msdf-atlas-gen` into an {@link MsdfFont}. Accepts
 * either the already-parsed object or a JSON string. Throws with a descriptive
 * message if a required field is missing or malformed, so a bad font asset fails
 * loudly at load time rather than silently rendering nothing.
 */
export function parseMsdfFont(input: string | unknown): MsdfFont {
  const json: unknown = typeof input === 'string' ? (JSON.parse(input) as unknown) : input;
  const root = requireObject(json, 'font');

  const atlas = requireObject(root.atlas, 'atlas');
  const metricsRaw = requireObject(root.metrics, 'metrics');
  const glyphsRaw = root.glyphs;
  if (!Array.isArray(glyphsRaw)) {
    throw new Error('parseMsdfFont: expected an array for "glyphs"');
  }

  const yOriginRaw = atlas.yOrigin;
  const yOrigin: AtlasYOrigin = yOriginRaw === 'top' ? 'top' : 'bottom';

  const metrics: FontMetrics = {
    emSize: requireNumber(metricsRaw.emSize, 'metrics.emSize'),
    lineHeight: requireNumber(metricsRaw.lineHeight, 'metrics.lineHeight'),
    ascender: requireNumber(metricsRaw.ascender, 'metrics.ascender'),
    descender: requireNumber(metricsRaw.descender, 'metrics.descender'),
    ...(typeof metricsRaw.underlineY === 'number' ? { underlineY: metricsRaw.underlineY } : {}),
    ...(typeof metricsRaw.underlineThickness === 'number'
      ? { underlineThickness: metricsRaw.underlineThickness }
      : {}),
  };

  const glyphs = new Map<number, GlyphMetrics>();
  for (const entry of glyphsRaw) {
    const g = requireObject(entry, 'glyph');
    const codepoint = requireNumber(g.unicode, 'glyph.unicode');
    const glyph: GlyphMetrics = {
      codepoint,
      advance: requireNumber(g.advance, 'glyph.advance'),
      ...(g.planeBounds !== undefined ? { plane: readRect(g.planeBounds, 'glyph.planeBounds') } : {}),
      ...(g.atlasBounds !== undefined ? { atlas: readRect(g.atlasBounds, 'glyph.atlasBounds') } : {}),
    };
    glyphs.set(codepoint, glyph);
  }

  const kerning = new Map<string, number>();
  if (Array.isArray(root.kerning)) {
    for (const entry of root.kerning) {
      const k = requireObject(entry, 'kerning');
      const left = requireNumber(k.unicode1, 'kerning.unicode1');
      const right = requireNumber(k.unicode2, 'kerning.unicode2');
      kerning.set(kerningKey(left, right), requireNumber(k.advance, 'kerning.advance'));
    }
  }

  return new MsdfFont({
    metrics,
    distanceRange: requireNumber(atlas.distanceRange, 'atlas.distanceRange'),
    atlasWidth: requireNumber(atlas.width, 'atlas.width'),
    atlasHeight: requireNumber(atlas.height, 'atlas.height'),
    atlasType: typeof atlas.type === 'string' ? atlas.type : 'msdf',
    yOrigin,
    glyphs,
    kerning,
  });
}
