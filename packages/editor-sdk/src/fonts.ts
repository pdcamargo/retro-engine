import { FreeTypeLoaderFlags, ImFontConfig, ImGui, type ImFont, Mod } from '@mori2003/jsimgui';

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
  /**
   * Merge this font's glyphs into the previously-registered font rather than
   * adding a standalone face. Use for an icon font: register the UI font first,
   * then the icon font with `merge: true`, so a single face carries both the
   * text and the icon glyphs (referenced by codepoint). Merged fonts get no
   * registry entry of their own.
   */
  readonly merge?: boolean;
  /**
   * Minimum horizontal advance for this font's glyphs, in pixels. For a merged
   * icon font, set this to the icon box size so icons reserve consistent,
   * monospace-aligned width inline with text.
   */
  readonly glyphMinAdvanceX?: number;
  /**
   * Inclusive, zero-terminated codepoint ranges to load from this font (e.g.
   * `[0xe000, 0xf8ff, 0]` for an icon font in the Private Use Area). Required so
   * a merged icon font's glyphs are actually built into the atlas.
   */
  readonly glyphRanges?: readonly number[];
  /**
   * Rasterize this font as crisp 1-bit pixels (no anti-aliasing). Use for a
   * pixel/bitmap display face (e.g. Silkscreen) so it reads as sharp pixels
   * rather than a blurred outline. Requires the FreeType glyph loader.
   */
  readonly crisp?: boolean;
}

const registry = new Map<string, ImFont>();

/**
 * Allocate a native {@link ImFontConfig} and restore the defaults ImGui relies
 * on (the raw struct comes zero-initialized — no C++ ctor runs through embind).
 */
const makeConfig = (): ImFontConfig => {
  const cfg = ImFontConfig.From(new (Mod.export as { ImFontConfig: new () => unknown }).ImFontConfig());
  cfg.RasterizerMultiply = 1;
  cfg.RasterizerDensity = 1;
  cfg.OversampleH = 1;
  cfg.OversampleV = 1;
  cfg.GlyphMaxAdvanceX = 3.4028235e38; // FLT_MAX
  return cfg;
};

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
    const size = spec.sizePixels ?? 16;
    const ranges = spec.glyphRanges !== undefined ? [...spec.glyphRanges] : null;
    if (spec.merge === true) {
      const cfg = makeConfig();
      cfg.MergeMode = true;
      cfg.GlyphMinAdvanceX = spec.glyphMinAdvanceX ?? 0;
      io.Fonts.AddFontFromFileTTF(spec.name, size, cfg, ranges);
      continue;
    }
    let cfg: ImFontConfig | null = null;
    if (spec.crisp === true) {
      cfg = makeConfig();
      cfg.FontLoaderFlags = FreeTypeLoaderFlags.Monochrome | FreeTypeLoaderFlags.NoHinting;
    }
    const font = io.Fonts.AddFontFromFileTTF(spec.name, size, cfg, ranges);
    registry.set(spec.name, font);
    if (spec.default === true) io.FontDefault = font;
  }
  if (baseSizePx !== undefined) ImGui.GetStyle().FontSizeBase = baseSizePx;
};

/** The registered {@link ImFont} for `name`, or `undefined` if none was registered. */
export const getFont = (name: string): ImFont | undefined => registry.get(name);
