import type { ThemeMetrics, ThemeTokens } from './tokens';
import type { Vec2 } from './units';

const nonNeg = (n: number): number => (n < 0 ? 0 : n);
const unit = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);
const nonNegVec2 = (v: Vec2): Vec2 => [nonNeg(v[0]), nonNeg(v[1])];
const unitVec2 = (v: Vec2): Vec2 => [unit(v[0]), unit(v[1])];

/**
 * Validate and normalize a {@link ThemeTokens} value into the ranges the style
 * backend expects: every length to a non-negative pixel value and every
 * alignment component into `0..1`. The palette passes through unchanged (the
 * backend clamps colors). Pure and backend-free — {@link applyTheme} consumes
 * the result.
 */
export const resolveTheme = (tokens: ThemeTokens): ThemeTokens => {
  const m = tokens.metrics;
  const metrics: ThemeMetrics = {
    windowPadding: nonNegVec2(m.windowPadding),
    framePadding: nonNegVec2(m.framePadding),
    cellPadding: nonNegVec2(m.cellPadding),
    itemSpacing: nonNegVec2(m.itemSpacing),
    itemInnerSpacing: nonNegVec2(m.itemInnerSpacing),
    indentSpacing: nonNeg(m.indentSpacing),
    scrollbarSize: nonNeg(m.scrollbarSize),
    grabMinSize: nonNeg(m.grabMinSize),
    borderSize: nonNeg(m.borderSize),
    tabBorderSize: nonNeg(m.tabBorderSize),
    tabBarOverlineSize: nonNeg(m.tabBarOverlineSize),
    separatorTextBorderSize: nonNeg(m.separatorTextBorderSize),
    windowRounding: nonNeg(m.windowRounding),
    childRounding: nonNeg(m.childRounding),
    frameRounding: nonNeg(m.frameRounding),
    popupRounding: nonNeg(m.popupRounding),
    scrollbarRounding: nonNeg(m.scrollbarRounding),
    grabRounding: nonNeg(m.grabRounding),
    tabRounding: nonNeg(m.tabRounding),
    windowTitleAlign: unitVec2(m.windowTitleAlign),
    buttonTextAlign: unitVec2(m.buttonTextAlign),
    selectableTextAlign: unitVec2(m.selectableTextAlign),
  };
  return { palette: tokens.palette, metrics };
};
