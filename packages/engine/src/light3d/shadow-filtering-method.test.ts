import { describe, expect, it } from 'bun:test';

import {
  SHADOW_FILTERING_METHOD_ORDINAL,
  ShadowFilteringMethod,
} from './shadow-filtering-method';
import { SHADOW3D_WGSL } from './shadow-3d.wgsl';

describe('ShadowFilteringMethod', () => {
  it('exposes Hardware2x2, Castano13, and Pcf5x5 as literal-keyed values', () => {
    expect(ShadowFilteringMethod.Hardware2x2).toBe('Hardware2x2');
    expect(ShadowFilteringMethod.Castano13).toBe('Castano13');
    expect(ShadowFilteringMethod.Pcf5x5).toBe('Pcf5x5');
  });

  it('is frozen so callers cannot mutate the public enum surface', () => {
    expect(Object.isFrozen(ShadowFilteringMethod)).toBe(true);
  });
});

describe('SHADOW_FILTERING_METHOD_ORDINAL ↔ WGSL', () => {
  // The WGSL dispatch in `retro_engine::shadow3d` branches on the same ordinals
  // that `packShadowFlags` writes. If these drift, hardware-2×2 fragments
  // would pick the Castano13 path (or worse). Lock them together.
  it('matches the SHADOW3D_FILTER_* constants embedded in SHADOW3D_WGSL', () => {
    expect(SHADOW_FILTERING_METHOD_ORDINAL.Hardware2x2).toBe(0);
    expect(SHADOW_FILTERING_METHOD_ORDINAL.Castano13).toBe(1);
    expect(SHADOW_FILTERING_METHOD_ORDINAL.Pcf5x5).toBe(2);
    // The Hardware2x2 ordinal is the implicit fallback (no `if` in WGSL); the
    // other two are explicit branches.
    expect(SHADOW3D_WGSL).toContain('method == 1u');
    expect(SHADOW3D_WGSL).toContain('method == 2u');
  });
});
