import type { Rgba, Vec2 } from './units';

/**
 * Semantic colors for the UI surface. Each is an {@link Rgba} in `0..1` space.
 * Names are intent-based (what the color is *for*), not widget-specific, so a
 * single token drives every related widget state.
 */
export interface ThemeColorTokens {
  /** Default text. */
  readonly text: Rgba;
  /** Panel / window background. */
  readonly surface: Rgba;
  /** Title bar of an inactive window. */
  readonly title: Rgba;
  /** Title bar of the focused window. */
  readonly titleActive: Rgba;
  /** Background of input frames (fields, sliders, checkboxes). */
  readonly field: Rgba;
  /** Hovered input frame. */
  readonly fieldHovered: Rgba;
  /** Primary action / accent (buttons, selection). */
  readonly accent: Rgba;
  /** Hovered accent. */
  readonly accentHovered: Rgba;
  /** Pressed accent. */
  readonly accentActive: Rgba;
  /** Indicator marks (checkmarks, slider grabs). */
  readonly indicator: Rgba;
  /** Borders and separators. */
  readonly border: Rgba;
}

/**
 * Scalar and 2D metrics for the UI surface — corner radii, border thickness,
 * and the padding/spacing rhythm. Lengths are in pixels.
 */
export interface ThemeMetricsTokens {
  readonly windowRounding: number;
  readonly frameRounding: number;
  readonly grabRounding: number;
  readonly borderSize: number;
  readonly windowPadding: Vec2;
  readonly framePadding: Vec2;
  readonly itemSpacing: Vec2;
}

/**
 * The full set of design tokens that style the UI surface. This typed module is
 * the canonical, consumer-facing source of truth: an author-time design export
 * is mapped into a `ThemeTokens` value, which {@link applyTheme} turns into the
 * underlying style state.
 */
export interface ThemeTokens {
  readonly color: ThemeColorTokens;
  readonly metrics: ThemeMetricsTokens;
}

/**
 * Placeholder dark theme. Stands in until a real design export is supplied;
 * tuned to sit on the playground's dark clear color rather than to be final.
 */
export const defaultTokens: ThemeTokens = {
  color: {
    text: [0.88, 0.89, 0.92, 1],
    surface: [0.1, 0.11, 0.14, 0.96],
    title: [0.12, 0.13, 0.17, 1],
    titleActive: [0.16, 0.18, 0.24, 1],
    field: [0.16, 0.17, 0.21, 1],
    fieldHovered: [0.2, 0.22, 0.27, 1],
    accent: [0.26, 0.46, 0.72, 1],
    accentHovered: [0.32, 0.54, 0.82, 1],
    accentActive: [0.22, 0.4, 0.64, 1],
    indicator: [0.5, 0.72, 1, 1],
    border: [0.24, 0.26, 0.32, 0.6],
  },
  metrics: {
    windowRounding: 6,
    frameRounding: 4,
    grabRounding: 4,
    borderSize: 1,
    windowPadding: [10, 8],
    framePadding: [8, 4],
    itemSpacing: [8, 6],
  },
};
