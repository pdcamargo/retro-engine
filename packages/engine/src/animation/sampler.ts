import type { KeyframeSampler } from './animation-clip';

/**
 * Sample `sampler` at `time` (seconds) into `out`, writing `componentCount`
 * interpolated scalar components. `slerp` selects spherical interpolation for
 * the `LINEAR`/`CUBICSPLINE` modes (use it for quaternion tracks so rotation
 * follows the shortest great-circle arc and the result stays normalized);
 * otherwise components are blended independently.
 *
 * `time` is clamped to the keyframe range — before the first or after the last
 * keyframe the endpoint value is held. Allocation-free: `out` is the only
 * destination and must be at least `componentCount` long.
 */
export const sampleInto = (
  sampler: KeyframeSampler,
  time: number,
  slerp: boolean,
  out: Float32Array,
): void => {
  const { times, componentCount: cc, interpolation } = sampler;
  const n = times.length;
  if (n === 0) return;
  if (n === 1 || time <= times[0]!) {
    copyValue(sampler, 0, out);
    return;
  }
  if (time >= times[n - 1]!) {
    copyValue(sampler, n - 1, out);
    return;
  }

  // Largest keyframe index `i` with times[i] <= time; the active interval is [i, i+1].
  const i = upperBound(times, time) - 1;
  const t0 = times[i]!;
  const t1 = times[i + 1]!;
  const dt = t1 - t0;
  const f = dt > 0 ? (time - t0) / dt : 0;

  if (interpolation === 'STEP') {
    copyValue(sampler, i, out);
    return;
  }

  if (interpolation === 'CUBICSPLINE') {
    hermite(sampler, i, i + 1, f, dt, out);
    if (slerp) normalizeInPlace(out, cc);
    return;
  }

  // LINEAR
  if (slerp && cc === 4) {
    slerpQuat(sampler, i, i + 1, f, out);
    return;
  }
  const stride = cc;
  const a = i * stride;
  const b = (i + 1) * stride;
  const { values } = sampler;
  for (let c = 0; c < cc; c++) {
    const va = values[a + c]!;
    out[c] = va + (values[b + c]! - va) * f;
  }
};

/** Index of the first element of `times` strictly greater than `time` (binary search). */
const upperBound = (times: Float32Array, time: number): number => {
  let lo = 0;
  let hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (times[mid]! <= time) lo = mid + 1;
    else hi = mid;
  }
  return lo;
};

/** Copy keyframe `i`'s value into `out`, honoring the CUBICSPLINE 3×-stride layout. */
const copyValue = (sampler: KeyframeSampler, i: number, out: Float32Array): void => {
  const { values, componentCount: cc, interpolation } = sampler;
  const base = interpolation === 'CUBICSPLINE' ? i * 3 * cc + cc : i * cc;
  for (let c = 0; c < cc; c++) out[c] = values[base + c]!;
};

/**
 * Cubic Hermite blend of keyframes `i`→`j` at fraction `f`, with the per-keyframe
 * tangents scaled by the keyframe duration `dt` per the glTF spec. Layout per
 * keyframe is `[inTangent, value, outTangent]`.
 */
const hermite = (
  sampler: KeyframeSampler,
  i: number,
  j: number,
  f: number,
  dt: number,
  out: Float32Array,
): void => {
  const { values, componentCount: cc } = sampler;
  const stride = 3 * cc;
  const v0 = i * stride + cc; // value of keyframe i
  const out0 = i * stride + 2 * cc; // out-tangent of keyframe i
  const v1 = j * stride + cc; // value of keyframe j
  const in1 = j * stride; // in-tangent of keyframe j

  const f2 = f * f;
  const f3 = f2 * f;
  const h00 = 2 * f3 - 3 * f2 + 1;
  const h10 = f3 - 2 * f2 + f;
  const h01 = -2 * f3 + 3 * f2;
  const h11 = f3 - f2;

  for (let c = 0; c < cc; c++) {
    const p0 = values[v0 + c]!;
    const m0 = values[out0 + c]! * dt;
    const p1 = values[v1 + c]!;
    const m1 = values[in1 + c]! * dt;
    out[c] = h00 * p0 + h10 * m0 + h01 * p1 + h11 * m1;
  }
};

/** Shortest-path spherical linear interpolation of two LINEAR quaternion keyframes into `out`. */
const slerpQuat = (
  sampler: KeyframeSampler,
  i: number,
  j: number,
  f: number,
  out: Float32Array,
): void => {
  const { values } = sampler;
  const a = i * 4;
  const b = j * 4;
  const ax = values[a]!;
  const ay = values[a + 1]!;
  const az = values[a + 2]!;
  const aw = values[a + 3]!;
  let bx = values[b]!;
  let by = values[b + 1]!;
  let bz = values[b + 2]!;
  let bw = values[b + 3]!;

  let dot = ax * bx + ay * by + az * bz + aw * bw;
  // -q is the same rotation as q; flip the far endpoint so the blend takes the
  // short way around rather than spinning the long arc.
  if (dot < 0) {
    dot = -dot;
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
  }

  let s0: number;
  let s1: number;
  if (dot > 0.9995) {
    // Nearly parallel — slerp is numerically unstable, so fall back to nlerp.
    s0 = 1 - f;
    s1 = f;
  } else {
    const theta0 = Math.acos(dot);
    const sinTheta0 = Math.sin(theta0);
    const theta = theta0 * f;
    s1 = Math.sin(theta) / sinTheta0;
    s0 = Math.cos(theta) - (dot * s1);
  }

  let x = s0 * ax + s1 * bx;
  let y = s0 * ay + s1 * by;
  let z = s0 * az + s1 * bz;
  let w = s0 * aw + s1 * bw;
  const len = Math.hypot(x, y, z, w) || 1;
  x /= len;
  y /= len;
  z /= len;
  w /= len;
  out[0] = x;
  out[1] = y;
  out[2] = z;
  out[3] = w;
};

const normalizeInPlace = (out: Float32Array, cc: number): void => {
  let sum = 0;
  for (let c = 0; c < cc; c++) sum += out[c]! * out[c]!;
  const len = Math.sqrt(sum) || 1;
  for (let c = 0; c < cc; c++) out[c]! /= len;
};
