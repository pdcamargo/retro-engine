/**
 * The 2D blend-space weighting algorithm, mirroring Unity's blend-tree types.
 *
 * - `simpleDirectional` — one motion per direction plus an optional center
 *   motion; the sample blends the center and the two angularly-adjacent motions
 *   via barycentric weights.
 * - `freeformCartesian` — Cartesian gradient-band interpolation over arbitrary
 *   sample positions; angle is not special-cased.
 * - `freeformDirectional` — polar (directional) gradient-band interpolation;
 *   blends by both direction and magnitude, with the origin handled by magnitude.
 */
export type Blend2dMode = 'simpleDirectional' | 'freeformCartesian' | 'freeformDirectional';

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Renormalize the first `n` weights to sum to 1; if all are zero, give the nearest point full weight. */
const normalize = (out: Float32Array, n: number, nearest: number): void => {
  let sum = 0;
  for (let i = 0; i < n; i++) sum += out[i]!;
  if (sum > 0) {
    for (let i = 0; i < n; i++) out[i] = out[i]! / sum;
  } else if (n > 0) {
    out.fill(0, 0, n);
    out[nearest] = 1;
  }
};

/**
 * 1D blend weights: linear interpolation between the two thresholds that bracket
 * `param`, with the endpoints held outside the range. `thresholds` must be in
 * ascending order; `out` receives one weight per threshold (length ≥ count) and
 * the written weights sum to 1.
 */
export const weights1d = (
  thresholds: readonly number[],
  param: number,
  out: Float32Array,
): void => {
  const n = thresholds.length;
  out.fill(0, 0, n);
  if (n === 0) return;
  if (n === 1 || param <= thresholds[0]!) {
    out[0] = 1;
    return;
  }
  if (param >= thresholds[n - 1]!) {
    out[n - 1] = 1;
    return;
  }
  for (let i = 0; i < n - 1; i++) {
    const a = thresholds[i]!;
    const b = thresholds[i + 1]!;
    if (param >= a && param <= b) {
      const f = b > a ? (param - a) / (b - a) : 0;
      out[i] = 1 - f;
      out[i + 1] = f;
      return;
    }
  }
};

/** Signed angle from vector `a` to vector `b` in `(-π, π]`, or 0 if either is the zero vector. */
const signedAngle = (ax: number, ay: number, bx: number, by: number): number => {
  if ((ax === 0 && ay === 0) || (bx === 0 && by === 0)) return 0;
  return Math.atan2(ax * by - ay * bx, ax * bx + ay * by);
};

/** Index of the sample's nearest point (used as the degenerate-case fallback). */
const nearestPoint = (positions: Float32Array, n: number, px: number, py: number): number => {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < n; i++) {
    const dx = positions[i * 2]! - px;
    const dy = positions[i * 2 + 1]! - py;
    const d = dx * dx + dy * dy;
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
};

const weightsCartesian = (
  positions: Float32Array,
  n: number,
  px: number,
  py: number,
  out: Float32Array,
): void => {
  for (let i = 0; i < n; i++) {
    const ix = positions[i * 2]!;
    const iy = positions[i * 2 + 1]!;
    const ipx = px - ix;
    const ipy = py - iy;
    let w = 1;
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const ijx = positions[j * 2]! - ix;
      const ijy = positions[j * 2 + 1]! - iy;
      const denom = ijx * ijx + ijy * ijy;
      const tproj = denom > 0 ? (ipx * ijx + ipy * ijy) / denom : 0;
      const h = clamp01(1 - tproj);
      if (h < w) w = h;
    }
    out[i] = w;
  }
  normalize(out, n, nearestPoint(positions, n, px, py));
};

// Scales the angular axis into the same units as the radial axis in directional
// space (Johansen gradient-band convention).
const DIRECTIONAL_ANGLE_SCALE = 2;

const weightsDirectional = (
  positions: Float32Array,
  n: number,
  px: number,
  py: number,
  out: Float32Array,
): void => {
  const magS = Math.hypot(px, py);
  for (let i = 0; i < n; i++) {
    const ix = positions[i * 2]!;
    const iy = positions[i * 2 + 1]!;
    const magI = Math.hypot(ix, iy);
    let w = 1;
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const jx = positions[j * 2]!;
      const jy = positions[j * 2 + 1]!;
      const magJ = Math.hypot(jx, jy);
      const avgMag = (magI + magJ) * 0.5;
      const ipx = magS - magI;
      const ipy = signedAngle(ix, iy, px, py) * avgMag * DIRECTIONAL_ANGLE_SCALE;
      const ijx = magJ - magI;
      const ijy = signedAngle(ix, iy, jx, jy) * avgMag * DIRECTIONAL_ANGLE_SCALE;
      const denom = ijx * ijx + ijy * ijy;
      const tproj = denom > 0 ? (ipx * ijx + ipy * ijy) / denom : 0;
      const h = clamp01(1 - tproj);
      if (h < w) w = h;
    }
    out[i] = w;
  }
  normalize(out, n, nearestPoint(positions, n, px, py));
};

const TWO_PI = Math.PI * 2;

const weightsSimpleDirectional = (
  positions: Float32Array,
  n: number,
  px: number,
  py: number,
  out: Float32Array,
): void => {
  out.fill(0, 0, n);
  if (n === 0) return;
  if (n === 1) {
    out[0] = 1;
    return;
  }

  // The optional center motion sits at (or near) the origin.
  let center = -1;
  for (let i = 0; i < n; i++) {
    if (Math.hypot(positions[i * 2]!, positions[i * 2 + 1]!) < 1e-6) {
      center = i;
      break;
    }
  }

  const sampleAngle = Math.atan2(py, px);
  // Nearest directional motion clockwise (`b`) and counter-clockwise (`a`) of the
  // sample, by counter-clockwise angular distance — wraps around the circle.
  let a = -1;
  let b = -1;
  let aDelta = Infinity;
  let bDelta = -Infinity;
  for (let i = 0; i < n; i++) {
    if (i === center) continue;
    const angle = Math.atan2(positions[i * 2 + 1]!, positions[i * 2]!);
    let delta = (angle - sampleAngle) % TWO_PI;
    if (delta < 0) delta += TWO_PI;
    if (delta < aDelta) {
      aDelta = delta;
      a = i;
    }
    if (delta > bDelta) {
      bDelta = delta;
      b = i;
    }
  }

  if (a === -1) {
    // Only a center motion exists.
    if (center !== -1) out[center] = 1;
    else normalize(out, n, nearestPoint(positions, n, px, py));
    return;
  }
  if (a === b) {
    out[a] = 1;
    return;
  }

  // Barycentric weights of the triangle (origin, A, B) for the sample point;
  // the origin vertex's weight is the center motion's share.
  const ax = positions[a * 2]!;
  const ay = positions[a * 2 + 1]!;
  const bx = positions[b * 2]!;
  const by = positions[b * 2 + 1]!;
  const det = ax * by - ay * bx;
  let wa: number;
  let wb: number;
  if (det !== 0) {
    wa = (px * by - py * bx) / det;
    wb = (ax * py - ay * px) / det;
  } else {
    wa = 0.5;
    wb = 0.5;
  }
  let wc = 1 - wa - wb;
  if (wa < 0) wa = 0;
  if (wb < 0) wb = 0;
  if (wc < 0) wc = 0;
  out[a] = out[a]! + wa;
  out[b] = out[b]! + wb;
  if (center !== -1) out[center] = wc;
  normalize(out, n, nearestPoint(positions, n, px, py));
};

/**
 * 2D blend weights for the sample point `(px, py)` against `n` motion positions,
 * laid out interleaved in `positions` as `[x0, y0, x1, y1, …]`. `out` receives
 * one weight per motion (length ≥ `n`) summing to 1; `mode` selects the
 * weighting algorithm.
 */
export const weights2d = (
  mode: Blend2dMode,
  positions: Float32Array,
  n: number,
  px: number,
  py: number,
  out: Float32Array,
): void => {
  if (mode === 'freeformCartesian') weightsCartesian(positions, n, px, py, out);
  else if (mode === 'freeformDirectional') weightsDirectional(positions, n, px, py, out);
  else weightsSimpleDirectional(positions, n, px, py, out);
};
