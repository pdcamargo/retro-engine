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
