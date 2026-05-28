import { describe, expect, it } from 'bun:test';

import {
  DEFAULT_TONEMAPPING_METHOD,
  TONEMAPPING_METHODS,
  Tonemapping,
  type TonemappingMethod,
} from '../index';

describe('Tonemapping (component + method union)', () => {
  it('defaults to the engine default operator', () => {
    const tm = new Tonemapping();
    expect(tm.method).toBe(DEFAULT_TONEMAPPING_METHOD);
  });

  it('honours an explicit method', () => {
    const tm = new Tonemapping({ method: 'reinhard' });
    expect(tm.method).toBe('reinhard');
  });

  it('lists every method exactly once in TONEMAPPING_METHODS', () => {
    expect(new Set(TONEMAPPING_METHODS).size).toBe(TONEMAPPING_METHODS.length);
  });

  it('is frozen so consumers cannot mutate the canonical list', () => {
    expect(Object.isFrozen(TONEMAPPING_METHODS)).toBe(true);
  });

  it('includes the seven LUT-free operators ADR-0048 ships', () => {
    const expected: TonemappingMethod[] = [
      'aces_fitted',
      'agx',
      'blender_filmic',
      'none',
      'reinhard',
      'reinhard_luminance',
      'somewhat_boring_display_transform',
    ];
    expect([...TONEMAPPING_METHODS].sort()).toEqual([...expected].sort());
  });

  it('does not include `tony_mc_mapface` (gated on the asset system)', () => {
    expect((TONEMAPPING_METHODS as readonly string[])).not.toContain('tony_mc_mapface');
  });

  it('defaults to a LUT-free operator so HDR cameras work out of the box', () => {
    expect(TONEMAPPING_METHODS).toContain(DEFAULT_TONEMAPPING_METHOD);
    expect(DEFAULT_TONEMAPPING_METHOD).not.toBe('tony_mc_mapface');
  });
});
