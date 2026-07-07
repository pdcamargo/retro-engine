import { describe, expect, it } from 'bun:test';

import { UiNode } from '../ui-node';

import { computeSliderValue, UiSlider } from './ui-slider';
import { Interactable } from './ui-interaction';

describe('UiSlider', () => {
  it('defaults to value 0 over [0, 1]', () => {
    const s = new UiSlider();
    expect(s.value).toBe(0);
    expect(s.min).toBe(0);
    expect(s.max).toBe(1);
  });

  it('clamps the initial value into [min, max]', () => {
    expect(new UiSlider({ min: 0, max: 10, value: 25 }).value).toBe(10);
    expect(new UiSlider({ min: 0, max: 10, value: -5 }).value).toBe(0);
    expect(new UiSlider({ min: 0, max: 10, value: 4 }).value).toBe(4);
  });

  it('requires the Interactable machinery (and thus a UiNode)', () => {
    expect(UiSlider.requires).toContain(Interactable);
    expect(UiSlider.requires).toContain(UiNode);
  });
});

describe('computeSliderValue', () => {
  // Track spans x ∈ [100, 300] (width 200), value range [0, 10].
  it('maps the cursor across the track to the value range', () => {
    expect(computeSliderValue(100, 100, 200, 0, 10)).toBe(0); // left edge
    expect(computeSliderValue(200, 100, 200, 0, 10)).toBe(5); // midpoint
    expect(computeSliderValue(300, 100, 200, 0, 10)).toBe(10); // right edge
  });

  it('clamps outside the track to the ends', () => {
    expect(computeSliderValue(20, 100, 200, 0, 10)).toBe(0); // left of track
    expect(computeSliderValue(999, 100, 200, 0, 10)).toBe(10); // right of track
  });

  it('honours a non-zero min', () => {
    expect(computeSliderValue(200, 100, 200, -1, 1)).toBeCloseTo(0, 5); // midpoint of [-1,1]
    expect(computeSliderValue(100, 100, 200, -1, 1)).toBe(-1);
  });

  it('returns min for an unlaid-out (zero-width) track', () => {
    expect(computeSliderValue(150, 100, 0, 3, 7)).toBe(3);
  });
});
