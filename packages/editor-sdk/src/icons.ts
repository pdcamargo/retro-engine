import { LUCIDE_CODEPOINTS } from './icons-data';

/**
 * Any Lucide icon name (e.g. `'box'`, `'move-3d'`, `'folder-open'`). The full
 * set ships as data; the matching glyphs come from the icon font the consumer
 * merges into the UI font (see {@link FontSpec.merge}). Autocompletes over every
 * available icon, so new panels can reference any of them.
 */
export type IconName = keyof typeof LUCIDE_CODEPOINTS;

/**
 * The single-character glyph string for a Lucide icon, ready to draw with the
 * merged icon font (`ui.text`, `ui.icon`, draw-list text). Unknown names yield
 * an empty string rather than throwing, so a missing icon degrades to no glyph.
 */
export const iconGlyph = (name: IconName | (string & {})): string => {
  const cp = (LUCIDE_CODEPOINTS as Record<string, number | undefined>)[name];
  return cp === undefined ? '' : String.fromCodePoint(cp);
};
