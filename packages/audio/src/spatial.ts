/**
 * Stereo pan (`[-1, 1]`) for a sound at `sourceX` heard from `listenerX`, where
 * `panWidth` is the horizontal offset at which the pan reaches full left/right.
 * A source to the listener's right pans right (`+`). Clamped to the ends; a
 * non-positive `panWidth` yields center (`0`). Pure — the spatial-audio system's
 * pan logic, unit-tested. Distance attenuation is a separate concern.
 */
export const panForOffset = (sourceX: number, listenerX: number, panWidth: number): number => {
  if (panWidth <= 0) return 0;
  const t = (sourceX - listenerX) / panWidth;
  return t < -1 ? -1 : t > 1 ? 1 : t;
};

/** A normalized listener basis: the direction it faces + its up vector. */
export interface ListenerAxes {
  readonly forward: readonly [number, number, number];
  readonly up: readonly [number, number, number];
}

/** Normalize a 3-vector, falling back to `fallback` when it is (near) zero-length. */
const normalize3 = (
  x: number,
  y: number,
  z: number,
  fallback: readonly [number, number, number],
): [number, number, number] => {
  const len = Math.hypot(x, y, z);
  // `+ 0` normalizes any `-0` (from negating a 0 component) to `+0`.
  return len > 1e-6 ? [x / len + 0, y / len + 0, z / len + 0] : [fallback[0], fallback[1], fallback[2]];
};

/**
 * Extract a 3D listener's facing (`forward`) and `up` from a column-major world
 * transform `matrix`: forward is the normalized `-Z` basis column (a camera looks
 * down `-Z`), up is the normalized `+Y` basis column — so 3D audio tracks the
 * listener's rotation, not just its position. Degenerate (scale-0) axes fall back
 * to `(0,0,-1)` / `(0,1,0)`. Pure — the spatial-audio system's orientation logic,
 * unit-tested.
 */
export const listenerAxes = (matrix: ArrayLike<number>): ListenerAxes => ({
  forward: normalize3(-(matrix[8] ?? 0), -(matrix[9] ?? 0), -(matrix[10] ?? 1), [0, 0, -1]),
  up: normalize3(matrix[4] ?? 0, matrix[5] ?? 1, matrix[6] ?? 0, [0, 1, 0]),
});

/**
 * How distance attenuation falls off, matching the Web Audio `PannerNode`
 * distance models:
 * - `'linear'` — `1 - rolloff · (d − ref) / (max − ref)`, `d` clamped to
 *   `[ref, max]`. Bounded, reaches its floor at `maxDistance`.
 * - `'inverse'` — `ref / (ref + rolloff · (max(d, ref) − ref))`. Physically-
 *   plausible `1/d`-style falloff; never quite reaches `0`. Ignores `maxDistance`.
 * - `'exponential'` — `(max(d, ref) / ref) ^ (−rolloff)`. Steeper designer-tunable
 *   falloff; never quite reaches `0`. Ignores `maxDistance`.
 */
export type DistanceModel = 'linear' | 'inverse' | 'exponential';

/**
 * Distance-attenuation gain (`[0, 1]`) for a source `distance` units from the
 * listener, using the chosen {@link DistanceModel} (default `'linear'`). Full
 * volume within `refDistance`; how it fades beyond it depends on the model.
 *
 * Escape hatches (all return `1`, i.e. no attenuation): `rolloff <= 0` (the
 * pan-only case), a degenerate linear range (`maxDistance <= refDistance`), and a
 * non-positive `refDistance` for the ratio-based models. The result is clamped to
 * `[0, 1]`. Pure — the spatial-audio system's per-voice gain, unit-tested.
 */
export const attenuationForDistance = (
  distance: number,
  refDistance: number,
  maxDistance: number,
  rolloff: number,
  model: DistanceModel = 'linear',
): number => {
  if (rolloff <= 0) return 1;
  const ref = refDistance < 0 ? 0 : refDistance;
  if (model === 'linear') {
    const max = maxDistance < ref ? ref : maxDistance;
    if (max <= ref) return 1;
    const d = distance < ref ? ref : distance > max ? max : distance;
    const g = 1 - rolloff * ((d - ref) / (max - ref));
    return g < 0 ? 0 : g > 1 ? 1 : g;
  }
  if (ref <= 0) return 1; // inverse / exponential divide by the reference distance
  const d = distance < ref ? ref : distance; // max(distance, ref)
  const g = model === 'inverse' ? ref / (ref + rolloff * (d - ref)) : Math.pow(d / ref, -rolloff);
  return g < 0 ? 0 : g > 1 ? 1 : g;
};
