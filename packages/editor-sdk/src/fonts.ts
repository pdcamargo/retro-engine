import { ImGui, type ImFont } from '@mori2003/jsimgui';

/** A font to register with the UI layer. */
export interface FontSpec {
  /**
   * Stable key for this font — used both as the name the overlay stores its
   * bytes under and as the handle you pass to {@link Ui.pushFont}. Use a role
   * (e.g. `'ui'`, `'pixel'`), not a filename.
   */
  readonly name: string;
  /** Raw TTF/OTF file bytes. */
  readonly data: Uint8Array;
  /**
   * Base size in pixels. In Dear ImGui 1.92 fonts are size-scalable, so this is
   * the baseline; render at other sizes via {@link Ui.pushFont}. Defaults to 16.
   */
  readonly sizePixels?: number;
  /** Make this the default UI font (the first spec flagged `default` wins). */
  readonly default?: boolean;
}

const registry = new Map<string, ImFont>();

/**
 * Register fonts with the active UI context. `load` hands each font's bytes to
 * the overlay backend (which writes them where the binding can read them); the
 * font is then added to the atlas and remembered by name. Call once at startup,
 * after the overlay is initialized and before the first frame.
 *
 * @param load        Sink for font bytes — the overlay's `loadFont`.
 * @param specs       Fonts to register, in priority order (first is the atlas default).
 * @param baseSizePx  Optional global base font size (`io.FontSizeBase`).
 */
export const registerFonts = (
  load: (name: string, data: Uint8Array) => void,
  specs: readonly FontSpec[],
  baseSizePx?: number,
): void => {
  const io = ImGui.GetIO();
  for (const spec of specs) {
    load(spec.name, spec.data);
    const font = io.Fonts.AddFontFromFileTTF(spec.name, spec.sizePixels ?? 16);
    registry.set(spec.name, font);
    if (spec.default === true) io.FontDefault = font;
  }
  if (baseSizePx !== undefined) ImGui.GetStyle().FontSizeBase = baseSizePx;
};

/** The registered {@link ImFont} for `name`, or `undefined` if none was registered. */
export const getFont = (name: string): ImFont | undefined => registry.get(name);
