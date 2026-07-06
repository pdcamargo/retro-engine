import type { Handle } from '@retro-engine/assets';

import type { Image } from '../image/image';

import type { MsdfFont } from './font';
import {
  layoutText,
  measureText,
  type TextLayout,
  type TextLayoutOptions,
  type TextMeasure,
} from './text-layout';

/**
 * A loaded font asset: its parsed {@link MsdfFont} data paired with a handle to
 * the MSDF atlas {@link Image} that backs its glyphs. Produced by the font
 * importer and held in the `Fonts` store; a `Text2d` references it by handle.
 *
 * The atlas image is loaded as a linear (non-sRGB) texture — its channels encode
 * signed distances, not colour, and must not be gamma-decoded.
 */
export class Font {
  /** Parsed metrics, glyphs, kerning, and atlas geometry. */
  readonly data: MsdfFont;
  /** Handle to the MSDF atlas texture the glyphs sample from. */
  readonly atlas: Handle<Image>;

  constructor(data: MsdfFont, atlas: Handle<Image>) {
    this.data = data;
    this.atlas = atlas;
  }

  /** Shape `text` into positioned glyph quads. See {@link layoutText}. */
  layout(text: string, options: TextLayoutOptions): TextLayout {
    return layoutText(this.data, text, options);
  }

  /** Measure `text`'s block bounds without producing quads. See {@link measureText}. */
  measure(text: string, options: TextLayoutOptions): TextMeasure {
    return measureText(this.data, text, options);
  }
}
