import type { Handle } from '@retro-engine/assets';

import { Image } from '../image/image';
import { Images } from '../image/images';
import type { App } from '../index';

import { Font } from './font-asset';
import { Fonts } from './fonts';
import { generateSdfFont, type SdfFontOptions, type StrokeSegment } from './sdf-generator';

// Monoline uppercase-derived glyph shapes on a 4-wide × 6-tall grid (baseline
// y = 0, cap height y = 6, Y up). Curves are approximated with short polylines.
// Lowercase reuses the uppercase shapes (a common retro default-font choice).
const UPPER: Record<string, readonly StrokeSegment[]> = {
  A: [[0, 0, 2, 6], [4, 0, 2, 6], [1, 2, 3, 2]],
  B: [[0, 0, 0, 6], [0, 6, 3, 6], [3, 6, 3, 3], [0, 3, 3, 3], [3, 3, 3, 0], [0, 0, 3, 0]],
  C: [[4, 5, 3, 6], [3, 6, 1, 6], [1, 6, 0, 5], [0, 5, 0, 1], [0, 1, 1, 0], [1, 0, 3, 0], [3, 0, 4, 1]],
  D: [[0, 0, 0, 6], [0, 6, 2, 6], [2, 6, 4, 4], [4, 4, 4, 2], [4, 2, 2, 0], [2, 0, 0, 0]],
  E: [[0, 0, 0, 6], [0, 6, 4, 6], [0, 3, 3, 3], [0, 0, 4, 0]],
  F: [[0, 0, 0, 6], [0, 6, 4, 6], [0, 3, 3, 3]],
  G: [[4, 5, 3, 6], [3, 6, 1, 6], [1, 6, 0, 5], [0, 5, 0, 1], [0, 1, 1, 0], [1, 0, 3, 0], [3, 0, 4, 1], [4, 1, 4, 3], [4, 3, 2, 3]],
  H: [[0, 0, 0, 6], [4, 0, 4, 6], [0, 3, 4, 3]],
  I: [[2, 0, 2, 6], [1, 6, 3, 6], [1, 0, 3, 0]],
  J: [[2, 6, 4, 6], [4, 6, 4, 1], [4, 1, 3, 0], [3, 0, 1, 0], [1, 0, 0, 1]],
  K: [[0, 0, 0, 6], [0, 3, 4, 6], [0, 3, 4, 0]],
  L: [[0, 0, 0, 6], [0, 0, 4, 0]],
  M: [[0, 0, 0, 6], [0, 6, 2, 3], [2, 3, 4, 6], [4, 6, 4, 0]],
  N: [[0, 0, 0, 6], [0, 6, 4, 0], [4, 0, 4, 6]],
  O: [[1, 6, 3, 6], [3, 6, 4, 5], [4, 5, 4, 1], [4, 1, 3, 0], [3, 0, 1, 0], [1, 0, 0, 1], [0, 1, 0, 5], [0, 5, 1, 6]],
  P: [[0, 0, 0, 6], [0, 6, 3, 6], [3, 6, 4, 5], [4, 5, 4, 4], [4, 4, 3, 3], [3, 3, 0, 3]],
  Q: [[1, 6, 3, 6], [3, 6, 4, 5], [4, 5, 4, 1], [4, 1, 3, 0], [3, 0, 1, 0], [1, 0, 0, 1], [0, 1, 0, 5], [0, 5, 1, 6], [2, 2, 4, 0]],
  R: [[0, 0, 0, 6], [0, 6, 3, 6], [3, 6, 4, 5], [4, 5, 4, 4], [4, 4, 3, 3], [3, 3, 0, 3], [2, 3, 4, 0]],
  S: [[4, 5, 3, 6], [3, 6, 1, 6], [1, 6, 0, 5], [0, 5, 0, 4], [0, 4, 1, 3], [1, 3, 3, 3], [3, 3, 4, 2], [4, 2, 4, 1], [4, 1, 3, 0], [3, 0, 1, 0], [1, 0, 0, 1]],
  T: [[0, 6, 4, 6], [2, 6, 2, 0]],
  U: [[0, 6, 0, 1], [0, 1, 1, 0], [1, 0, 3, 0], [3, 0, 4, 1], [4, 1, 4, 6]],
  V: [[0, 6, 2, 0], [2, 0, 4, 6]],
  W: [[0, 6, 1, 0], [1, 0, 2, 3], [2, 3, 3, 0], [3, 0, 4, 6]],
  X: [[0, 0, 4, 6], [0, 6, 4, 0]],
  Y: [[0, 6, 2, 3], [4, 6, 2, 3], [2, 3, 2, 0]],
  Z: [[0, 6, 4, 6], [4, 6, 0, 0], [0, 0, 4, 0]],
};

const DIGITS: Record<string, readonly StrokeSegment[]> = {
  '0': [[1, 6, 3, 6], [3, 6, 4, 5], [4, 5, 4, 1], [4, 1, 3, 0], [3, 0, 1, 0], [1, 0, 0, 1], [0, 1, 0, 5], [0, 5, 1, 6], [1, 1, 3, 5]],
  '1': [[1, 5, 2, 6], [2, 6, 2, 0], [1, 0, 3, 0]],
  '2': [[0, 5, 1, 6], [1, 6, 3, 6], [3, 6, 4, 5], [4, 5, 4, 4], [4, 4, 0, 0], [0, 0, 4, 0]],
  '3': [[0, 6, 3, 6], [3, 6, 4, 5], [4, 5, 4, 4], [4, 4, 2, 3], [2, 3, 4, 2], [4, 2, 4, 1], [4, 1, 3, 0], [3, 0, 0, 0]],
  '4': [[3, 0, 3, 6], [3, 6, 0, 2], [0, 2, 4, 2]],
  '5': [[4, 6, 0, 6], [0, 6, 0, 3], [0, 3, 3, 3], [3, 3, 4, 2], [4, 2, 4, 1], [4, 1, 3, 0], [3, 0, 0, 0]],
  '6': [[4, 5, 3, 6], [3, 6, 1, 6], [1, 6, 0, 4], [0, 4, 0, 1], [0, 1, 1, 0], [1, 0, 3, 0], [3, 0, 4, 1], [4, 1, 4, 2], [4, 2, 3, 3], [3, 3, 0, 3]],
  '7': [[0, 6, 4, 6], [4, 6, 1, 0]],
  '8': [[1, 6, 3, 6], [3, 6, 4, 5], [4, 5, 3, 3], [3, 3, 1, 3], [1, 3, 0, 5], [0, 5, 1, 6], [3, 3, 4, 1], [4, 1, 3, 0], [3, 0, 1, 0], [1, 0, 0, 1], [0, 1, 1, 3]],
  '9': [[4, 2, 4, 5], [4, 5, 3, 6], [3, 6, 1, 6], [1, 6, 0, 5], [0, 5, 0, 4], [0, 4, 1, 3], [1, 3, 4, 3], [4, 2, 2, 0]],
};

interface PunctDef {
  readonly char: string;
  readonly advance: number;
  readonly segments: readonly StrokeSegment[];
}

const PUNCT: readonly PunctDef[] = [
  { char: ' ', advance: 4, segments: [] },
  { char: '.', advance: 3, segments: [[1.7, 0.1, 2.3, 0.1]] },
  { char: ',', advance: 3, segments: [[2.2, 0.4, 1.5, -1.2]] },
  { char: '!', advance: 3, segments: [[2, 6, 2, 2], [1.8, 0.1, 2.2, 0.1]] },
  { char: '?', advance: 4, segments: [[0, 5, 1, 6], [1, 6, 3, 6], [3, 6, 4, 5], [4, 5, 4, 4], [4, 4, 2, 2.5], [2, 2.5, 2, 2], [1.8, 0.1, 2.2, 0.1]] },
  { char: ':', advance: 3, segments: [[1.8, 4, 2.2, 4], [1.8, 1, 2.2, 1]] },
  { char: '-', advance: 4, segments: [[0.5, 3, 3.5, 3]] },
  { char: "'", advance: 2, segments: [[2, 6, 1.7, 4.5]] },
];

const LETTER_ADVANCE = 5;

/**
 * Default geometry for the built-in font. Cap height 6 of 8 em units (0.75em),
 * stroke ~0.9 units, 6 texels per unit, `distanceRange` 4.
 */
export const DEFAULT_FONT_OPTIONS: SdfFontOptions = {
  cellWidth: 4,
  ascent: 6,
  descent: 2,
  emUnits: 8,
  strokeHalfWidth: 0.45,
  pixelsPerUnit: 6,
  distanceRange: 4,
  padding: 4,
  lineGap: 1,
};

/**
 * Generate the built-in default font's SDF atlas and metrics. Uppercase letters,
 * digits, common punctuation, and lowercase aliased to the uppercase shapes —
 * enough for legible sample/HUD text with no external font tooling. Returns a
 * linear-colour {@link Image} (a distance field, never gamma-decoded) and the
 * parsed font data.
 */
export const generateDefaultFontAtlas = (): { image: Image; data: import('./font').MsdfFont } => {
  const glyphs = [];
  for (const [ch, segments] of Object.entries(UPPER)) {
    glyphs.push({ codepoint: ch.charCodeAt(0), advance: LETTER_ADVANCE, segments });
    glyphs.push({ codepoint: ch.toLowerCase().charCodeAt(0), advance: LETTER_ADVANCE, segments });
  }
  for (const [ch, segments] of Object.entries(DIGITS)) {
    glyphs.push({ codepoint: ch.charCodeAt(0), advance: LETTER_ADVANCE, segments });
  }
  for (const p of PUNCT) {
    glyphs.push({ codepoint: p.char.charCodeAt(0), advance: p.advance, segments: p.segments });
  }

  const { rgba, width, height, font } = generateSdfFont(glyphs, DEFAULT_FONT_OPTIONS);
  const image = Image.fromBytes({
    data: rgba,
    format: 'rgba8unorm',
    colorSpace: 'linear',
    width,
    height,
    label: 'font-atlas:default',
  });
  return { image, data: font };
};

/**
 * Generate, register, and return a handle to the built-in default {@link Font}:
 * the atlas image is added to {@link Images} (and uploaded by `ImagePlugin`), the
 * font is added to {@link Fonts}. Requires `TextPlugin` (and `ImagePlugin`) to
 * have run. A one-call way to get drawable text with no font asset on disk.
 */
export const installDefaultFont = (app: App): Handle<Font> => {
  const images = app.getResource(Images);
  const fonts = app.getResource(Fonts);
  if (images === undefined || fonts === undefined) {
    throw new Error('installDefaultFont: Images and Fonts resources required (add ImagePlugin + TextPlugin first).');
  }
  const { image, data } = generateDefaultFontAtlas();
  const atlas = images.add(image);
  return fonts.add(new Font(data, atlas));
};
