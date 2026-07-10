import type { Font, Fonts, Handle, TextLayoutOptions } from '@retro-engine/engine';

import type { MeasureFunc } from './layout-engine';
import type { UiText } from './ui-text';

/**
 * Build the intrinsic {@link MeasureFunc} for a {@link UiText} node, backed by
 * the engine's text layer. The returned function shapes the text at the width
 * the layout engine offers (wrapping to it when finite) and returns the block's
 * natural size, so flexbox can size a text node to its content.
 *
 * The node's own {@link UiText.font} is used when set, otherwise `defaultFont`
 * (the engine's built-in font) so text sizes without an explicit font asset.
 *
 * Returns `undefined` — leaving the node sized by its {@link UiStyle} alone —
 * when the text is empty, no font is available, or the font is not loaded yet.
 * This keeps the layout pass resilient: a font that arrives a frame later simply
 * starts contributing an intrinsic size on the next pass.
 */
export const makeTextMeasure = (
  uiText: UiText,
  fonts: Fonts,
  defaultFont?: Handle<Font>,
): MeasureFunc | undefined => {
  const handle = uiText.font ?? defaultFont;
  if (uiText.text.length === 0 || handle === undefined) return undefined;
  const font = fonts.get(handle);
  if (font === undefined) return undefined;

  return (availableWidth) => {
    const options: TextLayoutOptions = {
      fontSize: uiText.fontSize,
      letterSpacing: uiText.letterSpacing,
      ...(uiText.lineHeight !== undefined ? { lineHeight: uiText.lineHeight } : {}),
      ...(Number.isFinite(availableWidth) ? { maxWidth: availableWidth } : {}),
    };
    const measured = font.measure(uiText.text, options);
    return { width: measured.width, height: measured.height };
  };
};
