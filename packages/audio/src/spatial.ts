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

/**
 * Distance-attenuation gain (`[0, 1]`) for a source `distance` units from the
 * listener, using the Web Audio **linear** model:
 * `1 - rolloff * (d - refDistance) / (maxDistance - refDistance)`, with `d`
 * clamped to `[refDistance, maxDistance]`. Full volume within `refDistance`,
 * fading to `1 - rolloff` at (and beyond) `maxDistance`.
 *
 * Escape hatches: `rolloff <= 0` (the default-off case for pan-only spatial
 * sources) and a degenerate `maxDistance <= refDistance` both return `1` (no
 * attenuation). The result is clamped to `[0, 1]`. Pure — the spatial-audio
 * system's per-voice gain, unit-tested.
 */
export const attenuationForDistance = (
  distance: number,
  refDistance: number,
  maxDistance: number,
  rolloff: number,
): number => {
  if (rolloff <= 0) return 1;
  const ref = refDistance < 0 ? 0 : refDistance;
  const max = maxDistance < ref ? ref : maxDistance;
  if (max <= ref) return 1;
  const d = distance < ref ? ref : distance > max ? max : distance;
  const g = 1 - rolloff * ((d - ref) / (max - ref));
  return g < 0 ? 0 : g > 1 ? 1 : g;
};
