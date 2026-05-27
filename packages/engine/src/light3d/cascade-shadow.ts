import type { Mat4, Vec3 } from '@retro-engine/math';
import { mat4, vec3 } from '@retro-engine/math';

import { MAX_CASCADES } from './cascade-shadow-config';
import { MAX_SHADOW_CASTERS, NO_SHADOW_CASTER } from './gpu-lights';
import { SHADOW_MAP_SIZE } from './shadow-3d';

// Scratch reused across cascade fits; these helpers run on the render thread,
// one cascade at a time, so a shared scratch is safe and avoids per-call allocs.
const scratchCorners: Vec3[] = Array.from({ length: 8 }, () => vec3.create());
const scratchCenter = vec3.create();
const scratchEye = vec3.create();
const scratchUp = vec3.create();
const scratchOrigin = vec3.create();
const scratchLightView = mat4.identity() as Mat4;
const scratchOrtho = mat4.identity() as Mat4;

/** A world-up that is not (near-)parallel to `forward`, written into `out`. */
const upForInto = (forward: Vec3, out: Vec3): Vec3 =>
  Math.abs(forward[1] as number) > 0.99 ? vec3.set(0, 0, 1, out) : vec3.set(0, 1, 0, out);

const setCorner = (index: number, x: number, y: number, z: number, invView: Mat4): void => {
  const c = scratchCorners[index] as Vec3;
  vec3.set(x, y, z, c);
  vec3.transformMat4(c, invView, c);
};

/**
 * Compute the cascade split distances for a directional shadow. The camera's
 * view-space depth range `[nearD, farD]` is divided into `numCascades` slices
 * via the practical split scheme — a blend (`lambda`) of a uniform and a
 * logarithmic distribution. Logarithmic (`lambda → 1`) gives nearer cascades
 * more resolution; uniform (`lambda → 0`) spreads them evenly.
 *
 * Writes each cascade's **far** distance (view-space, world units) into
 * `out[0..N-1]`, padding the remaining slots up to {@link MAX_CASCADES} with
 * `farD`. The last cascade's far is exactly `farD`; the first cascade's near is
 * `nearD`. Distances are strictly increasing.
 *
 * @param numCascades Requested cascade count, clamped to `[1, ${MAX_CASCADES}]`.
 * @param nearD       Near edge of the first cascade (view-space distance, > 0).
 * @param farD        Far edge of the last cascade (the shadow draw distance).
 * @param lambda      Uniform-to-logarithmic blend, clamped to `[0, 1]`.
 * @param out         Destination, length ≥ {@link MAX_CASCADES}.
 * @param firstCascadeFarBound Optional override for `out[0]`, clamped to a valid range.
 * @returns The clamped cascade count actually written.
 */
export const computeCascadeSplits = (
  numCascades: number,
  nearD: number,
  farD: number,
  lambda: number,
  out: Float32Array,
  firstCascadeFarBound?: number,
): number => {
  const n = Math.max(1, Math.min(Math.trunc(numCascades), MAX_CASCADES));
  const near = Math.max(nearD, 1e-4);
  const far = Math.max(farD, near + 1e-4);
  const lam = Math.max(0, Math.min(lambda, 1));
  const ratio = far / near;
  const range = far - near;
  for (let i = 1; i <= n; i++) {
    const p = i / n;
    const logSplit = near * ratio ** p;
    const uniformSplit = near + range * p;
    out[i - 1] = lam * logSplit + (1 - lam) * uniformSplit;
  }
  out[n - 1] = far;
  if (firstCascadeFarBound !== undefined) {
    const upper = n >= 2 ? (out[1] as number) : far;
    out[0] = Math.max(near, Math.min(firstCascadeFarBound, upper));
  }
  for (let i = n; i < MAX_CASCADES; i++) out[i] = far;
  return n;
};

/**
 * Inputs to {@link cascadeLightViewProj}. `invView` is the inverse of the
 * camera's view matrix (i.e. its world transform); `lightForward` is the
 * directional light's normalized travel direction.
 */
export interface CascadeFitParams {
  /** Inverse of the camera view matrix (camera-to-world). */
  invView: Mat4;
  /** `tan(verticalFov / 2)` of the camera. */
  tanHalfFovY: number;
  /** Camera width-over-height aspect ratio. */
  aspect: number;
  /** Near edge of this cascade's slice (view-space distance). */
  nearC: number;
  /** Far edge of this cascade's slice (view-space distance). */
  farC: number;
  /** Directional light's normalized travel direction (−Z of its transform). */
  lightForward: Vec3;
  /** Extra depth (world units) pulled toward the light to capture occluders behind the slice. */
  backExtension: number;
}

/**
 * Build the light-space view-projection that tightly fits one cascade slice of
 * the camera frustum, written into `out` (column-major). The slice corners are
 * bounded by a sphere (so the projection's size is invariant to camera rotation,
 * avoiding shimmer) and the projection is snapped to the shadow-map texel grid
 * (so it is stable under camera translation). The depth range is extended toward
 * the light by `backExtension` to include occluders just outside the slice.
 *
 * @returns `out`, for chaining.
 */
export const cascadeLightViewProj = (params: CascadeFitParams, out: Mat4): Mat4 => {
  const { invView, tanHalfFovY, aspect, nearC, farC, lightForward, backExtension } = params;

  const ny = nearC * tanHalfFovY;
  const nx = ny * aspect;
  const fy = farC * tanHalfFovY;
  const fx = fy * aspect;
  setCorner(0, -nx, -ny, -nearC, invView);
  setCorner(1, nx, -ny, -nearC, invView);
  setCorner(2, -nx, ny, -nearC, invView);
  setCorner(3, nx, ny, -nearC, invView);
  setCorner(4, -fx, -fy, -farC, invView);
  setCorner(5, fx, -fy, -farC, invView);
  setCorner(6, -fx, fy, -farC, invView);
  setCorner(7, fx, fy, -farC, invView);

  // Bounding sphere of the slice: centroid + max corner distance. Rigid camera
  // transforms preserve corner distances, so the radius (and thus the box size)
  // does not change as the camera rotates — the key to shimmer-free cascades.
  vec3.set(0, 0, 0, scratchCenter);
  for (let k = 0; k < 8; k++) vec3.add(scratchCenter, scratchCorners[k] as Vec3, scratchCenter);
  vec3.scale(scratchCenter, 1 / 8, scratchCenter);
  let radius = 1e-4;
  for (let k = 0; k < 8; k++) {
    const dist = vec3.distance(scratchCorners[k] as Vec3, scratchCenter);
    if (dist > radius) radius = dist;
  }

  upForInto(lightForward, scratchUp);
  // Eye behind the slice along the light direction so the whole sphere is in front.
  vec3.scale(lightForward, -(radius + backExtension), scratchEye);
  vec3.add(scratchEye, scratchCenter, scratchEye);
  mat4.lookAt(scratchEye, scratchCenter, scratchUp, scratchLightView);
  mat4.ortho(-radius, radius, -radius, radius, 0, 2 * radius + backExtension, scratchOrtho);
  mat4.multiply(scratchOrtho, scratchLightView, out);

  // Texel snap: shift the projection so the world origin lands on an exact texel
  // center. With a constant box size, this locks the texel grid to world space,
  // so shadows do not crawl as the camera moves.
  vec3.set(0, 0, 0, scratchOrigin);
  vec3.transformMat4(scratchOrigin, out, scratchOrigin);
  const half = SHADOW_MAP_SIZE * 0.5;
  const offX = (Math.round((scratchOrigin[0] as number) * half) - (scratchOrigin[0] as number) * half) / half;
  const offY = (Math.round((scratchOrigin[1] as number) * half) - (scratchOrigin[1] as number) * half) / half;
  scratchOrtho[12] = (scratchOrtho[12] as number) + offX;
  scratchOrtho[13] = (scratchOrtho[13] as number) + offY;
  return mat4.multiply(scratchOrtho, scratchLightView, out) as Mat4;
};

/**
 * Reserve `count` consecutive shadow-atlas layers for one caster starting at
 * `nextLayer` (the count already assigned this frame), or
 * {@link NO_SHADOW_CASTER} when the run would exceed the {@link MAX_SHADOW_CASTERS}
 * budget. All-or-nothing: a partial cascade run is never assigned.
 */
export const reserveCasterLayers = (nextLayer: number, count: number): number =>
  nextLayer + count <= MAX_SHADOW_CASTERS ? nextLayer : NO_SHADOW_CASTER;
