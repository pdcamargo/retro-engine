import type { Font, Handle } from '@retro-engine/engine';

import { UiNode } from './ui-node';

/** Initializer for {@link UiText}; omitted fields take the defaults below. */
export interface UiTextOptions {
  /** The string to display. */
  text?: string;
  /** Handle to the font that shapes the text. Without one the node is not text-sized. */
  font?: Handle<Font>;
  /** Rendered em height in logical pixels. Default `16`. */
  fontSize?: number;
  /** Extra spacing after every glyph, in pixels. Default `0`. */
  letterSpacing?: number;
  /**
   * Distance between baselines in pixels. Defaults (`undefined`) to the font's
   * own line height scaled to {@link fontSize}.
   */
  lineHeight?: number;
}

/**
 * Text content for a UI node: the string plus the font metrics the layout pass
 * needs to size it. Placed on the same entity as a {@link UiNode}; the layout
 * system measures it through the engine's text layer so flexbox can size the
 * node to its text (wrapping to the width the layout gives it).
 *
 * Authored state — every field persists. Visual styling (color, alignment) is a
 * rendering concern applied separately and is not carried here.
 */
export class UiText {
  /** The string to display. */
  text: string;
  /** Handle to the font that shapes the text, if any. */
  font: Handle<Font> | undefined;
  /** Rendered em height, in logical pixels. */
  fontSize: number;
  /** Extra spacing after every glyph, in pixels. */
  letterSpacing: number;
  /** Distance between baselines in pixels, or `undefined` for the font default. */
  lineHeight: number | undefined;

  constructor(options: UiTextOptions = {}) {
    this.text = options.text ?? '';
    this.font = options.font;
    this.fontSize = options.fontSize ?? 16;
    this.letterSpacing = options.letterSpacing ?? 0;
    this.lineHeight = options.lineHeight;
  }

  /** A text node is a UI node too — adding `UiText` auto-attaches a {@link UiNode}. */
  static readonly requires = [UiNode];
}
