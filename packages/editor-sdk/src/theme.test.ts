import { describe, expect, it } from 'bun:test';

import { resolveTheme } from './theme';
import { defaultTokens, type ThemeTokens } from './tokens';

describe('resolveTheme', () => {
  it('passes in-range tokens through unchanged', () => {
    const resolved = resolveTheme(defaultTokens);
    expect(resolved).toEqual(defaultTokens);
  });

  it('clamps color channels into 0..1', () => {
    const tokens: ThemeTokens = {
      ...defaultTokens,
      color: { ...defaultTokens.color, accent: [-0.5, 2, 0.5, 3] },
    };
    expect(resolveTheme(tokens).color.accent).toEqual([0, 1, 0.5, 1]);
  });

  it('clamps negative metrics to zero', () => {
    const tokens: ThemeTokens = {
      ...defaultTokens,
      metrics: { ...defaultTokens.metrics, windowRounding: -4, framePadding: [-2, 5] },
    };
    const resolved = resolveTheme(tokens);
    expect(resolved.metrics.windowRounding).toBe(0);
    expect(resolved.metrics.framePadding).toEqual([0, 5]);
  });
});
