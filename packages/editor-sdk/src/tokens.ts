import type { Srgb8, Vec2 } from './units';

/**
 * The Retro Engine color palette: a cool-charcoal neutral ramp with a faint
 * green cast, plus phosphor-green / cyan / amber accents. Each value is an
 * {@link Srgb8} tuple (`0..255`). This is the canonical theming knob — reskin
 * the editor by swapping these colors; {@link applyTheme} maps them onto every
 * widget slot (with the design's opinions baked in: green is a highlight only,
 * surfaces step up the ramp on interaction, depth from 1px borders not shadows).
 */
export interface RetroPalette {
  /** Deepest background — docking empty space, modal dim. */
  readonly gray0: Srgb8;
  /** Window background. */
  readonly gray1: Srgb8;
  /** Panel body / popup — the surface a selected tab merges into. */
  readonly gray2: Srgb8;
  /** Title bar, menu bar, table header, unselected tab. */
  readonly gray3: Srgb8;
  /** Control rest (frame / button). */
  readonly gray4: Srgb8;
  /** Control hover (+1 step). */
  readonly gray5: Srgb8;
  /** Control active / border (+1 more). */
  readonly gray6: Srgb8;
  /** Stronger border, scrollbar hover, resize grip. */
  readonly gray7: Srgb8;
  /** Brightest neutral — scrollbar active, disabled text. */
  readonly gray8: Srgb8;
  /** Default text. */
  readonly text: Srgb8;
  /** Secondary text — labels, inactive captions. */
  readonly textMuted: Srgb8;
  /** Disabled / secondary text. */
  readonly textFaint: Srgb8;
  /** Lighter accent (histogram hover). */
  readonly green300: Srgb8;
  /** Phosphor-green accent — checkmarks, grabs, selection, overline, nav. */
  readonly green400: Srgb8;
  /** Darker accent (slider grab at rest). */
  readonly green600: Srgb8;
  /** Plot lines, text links. */
  readonly cyan400: Srgb8;
  /** Drag-drop target (the loud signal). */
  readonly amber400: Srgb8;
  /** Plot-line hover. */
  readonly amber500: Srgb8;
  /** Danger / errors / the X axis. */
  readonly red400: Srgb8;
  /** Play-mode signal — the inset viewport border while running. */
  readonly magenta400: Srgb8;
  /** Near-white — nav windowing highlight, table zebra. */
  readonly white: Srgb8;
  /** Green-tinted title bar of the focused window. */
  readonly titleActive: Srgb8;
  /** Subtle table border. */
  readonly borderSubtle: Srgb8;
  /** Modal backdrop dim. */
  readonly modalDim: Srgb8;
}

/**
 * Spacing, sizing, border, rounding, and alignment metrics applied to
 * `ImGuiStyle`. Lengths are pixels on a 4px grid; the defaults tune for a dense
 * developer tool.
 */
export interface ThemeMetrics {
  readonly windowPadding: Vec2;
  readonly framePadding: Vec2;
  readonly cellPadding: Vec2;
  readonly itemSpacing: Vec2;
  readonly itemInnerSpacing: Vec2;
  readonly indentSpacing: number;
  readonly scrollbarSize: number;
  readonly grabMinSize: number;
  /** 1px structural border for windows, child frames, popups, and frames. */
  readonly borderSize: number;
  readonly tabBorderSize: number;
  /** Thickness of the accent overline on the selected tab. */
  readonly tabBarOverlineSize: number;
  readonly separatorTextBorderSize: number;
  readonly windowRounding: number;
  readonly childRounding: number;
  readonly frameRounding: number;
  readonly popupRounding: number;
  readonly scrollbarRounding: number;
  readonly grabRounding: number;
  readonly tabRounding: number;
  /** Each component in `0..1`. */
  readonly windowTitleAlign: Vec2;
  readonly buttonTextAlign: Vec2;
  readonly selectableTextAlign: Vec2;
}

/**
 * The full set of design tokens that style the UI surface — palette plus
 * metrics. This typed module is the canonical source of truth; {@link applyTheme}
 * turns it into the underlying style state.
 */
export interface ThemeTokens {
  readonly palette: RetroPalette;
  readonly metrics: ThemeMetrics;
}

/**
 * The type scale (px), mirroring the design system's `--text-*` ramp at a 16px
 * base. `sm` (13px) is the default editor UI size.
 */
export const FontScale = {
  xs2: 11,
  xs: 12,
  sm: 13,
  base: 15,
  lg: 20,
  xl: 24,
  xl2: 32,
} as const;

/** The Retro Engine design-system theme: phosphor green on cool charcoal, dense and sharp. */
export const defaultTokens: ThemeTokens = {
  palette: {
    gray0: [7, 11, 10],
    gray1: [11, 17, 16],
    gray2: [17, 24, 26],
    gray3: [22, 31, 33],
    gray4: [28, 38, 41],
    gray5: [36, 48, 52],
    gray6: [45, 60, 65],
    gray7: [58, 77, 84],
    gray8: [88, 109, 116],
    text: [194, 208, 200],
    textMuted: [138, 162, 156],
    textFaint: [88, 109, 116],
    green300: [92, 240, 154],
    green400: [52, 224, 122],
    green600: [24, 164, 85],
    cyan400: [56, 217, 240],
    amber400: [255, 194, 51],
    amber500: [255, 176, 0],
    red400: [240, 85, 106],
    magenta400: [232, 73, 200],
    white: [241, 250, 244],
    titleActive: [21, 33, 28],
    borderSubtle: [24, 35, 38],
    modalDim: [5, 9, 8],
  },
  metrics: {
    windowPadding: [8, 8],
    framePadding: [8, 6],
    cellPadding: [6, 4],
    itemSpacing: [8, 6],
    itemInnerSpacing: [6, 4],
    indentSpacing: 16,
    scrollbarSize: 12,
    grabMinSize: 10,
    borderSize: 1,
    tabBorderSize: 0,
    tabBarOverlineSize: 2,
    separatorTextBorderSize: 2,
    windowRounding: 0,
    childRounding: 4,
    frameRounding: 2,
    popupRounding: 6,
    scrollbarRounding: 2,
    grabRounding: 2,
    tabRounding: 2,
    windowTitleAlign: [0, 0.5],
    buttonTextAlign: [0.5, 0.5],
    selectableTextAlign: [0, 0.5],
  },
};
