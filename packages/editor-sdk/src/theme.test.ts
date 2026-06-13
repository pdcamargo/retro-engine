import { describe, expect, it } from 'bun:test';

import { resolveTheme } from './theme';
import { defaultTokens, type ThemeTokens } from './tokens';

describe('resolveTheme', () => {
  it('passes in-range tokens through unchanged', () => {
    expect(resolveTheme(defaultTokens)).toEqual(defaultTokens);
  });

  it('clamps negative lengths to zero', () => {
    const tokens: ThemeTokens = {
      ...defaultTokens,
      metrics: { ...defaultTokens.metrics, windowRounding: -4, framePadding: [-2, 5] },
    };
    const resolved = resolveTheme(tokens);
    expect(resolved.metrics.windowRounding).toBe(0);
    expect(resolved.metrics.framePadding).toEqual([0, 5]);
  });

  it('clamps alignment components into 0..1', () => {
    const tokens: ThemeTokens = {
      ...defaultTokens,
      metrics: { ...defaultTokens.metrics, buttonTextAlign: [-1, 2] },
    };
    expect(resolveTheme(tokens).metrics.buttonTextAlign).toEqual([0, 1]);
  });

  it('leaves the palette untouched', () => {
    expect(resolveTheme(defaultTokens).palette).toEqual(defaultTokens.palette);
  });
});
