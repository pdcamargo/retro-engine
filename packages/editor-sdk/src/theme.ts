import type { ThemeColorTokens, ThemeMetricsTokens, ThemeTokens } from './tokens';
import type { Rgba, Vec2 } from './units';

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);
const clampNonNegative = (n: number): number => (n < 0 ? 0 : n);

const normalizeColor = (c: Rgba): Rgba => [clamp01(c[0]), clamp01(c[1]), clamp01(c[2]), clamp01(c[3])];
const normalizeVec2 = (v: Vec2): Vec2 => [clampNonNegative(v[0]), clampNonNegative(v[1])];

/**
 * Validate and clamp a {@link ThemeTokens} value into the ranges the style
 * backend expects: every color channel into `0..1`, every length to a
 * non-negative pixel value. Pure and backend-free — {@link applyTheme} consumes
 * the result.
 */
export const resolveTheme = (tokens: ThemeTokens): ThemeTokens => {
  const color: ThemeColorTokens = {
    text: normalizeColor(tokens.color.text),
    surface: normalizeColor(tokens.color.surface),
    title: normalizeColor(tokens.color.title),
    titleActive: normalizeColor(tokens.color.titleActive),
    field: normalizeColor(tokens.color.field),
    fieldHovered: normalizeColor(tokens.color.fieldHovered),
    accent: normalizeColor(tokens.color.accent),
    accentHovered: normalizeColor(tokens.color.accentHovered),
    accentActive: normalizeColor(tokens.color.accentActive),
    indicator: normalizeColor(tokens.color.indicator),
    border: normalizeColor(tokens.color.border),
  };
  const metrics: ThemeMetricsTokens = {
    windowRounding: clampNonNegative(tokens.metrics.windowRounding),
    frameRounding: clampNonNegative(tokens.metrics.frameRounding),
    grabRounding: clampNonNegative(tokens.metrics.grabRounding),
    borderSize: clampNonNegative(tokens.metrics.borderSize),
    windowPadding: normalizeVec2(tokens.metrics.windowPadding),
    framePadding: normalizeVec2(tokens.metrics.framePadding),
    itemSpacing: normalizeVec2(tokens.metrics.itemSpacing),
  };
  return { color, metrics };
};
