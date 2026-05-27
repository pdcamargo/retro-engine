import type { Mat4 } from '@retro-engine/math';
import { mat4, vec3 } from '@retro-engine/math';

import { MAX_SHADOW_CASTERS, NO_SHADOW_CASTER } from './gpu-lights';
import type { Shadow3dSettings } from './shadow-3d-settings';

// Scratch reused across matrix builds; these helpers run on the render thread,
// one light at a time, so a shared scratch is safe and avoids per-call allocs.
const scratchEye = vec3.create();
const scratchTarget = vec3.create();
const scratchForward = vec3.create();
const scratchView = mat4.identity();
const scratchProj = mat4.identity();

const ORIGIN = vec3.create(0, 0, 0);
// Largest spot FOV we project — kept just under π so the perspective matrix
// stays finite even if a spot's outer cone approaches a full hemisphere.
const MAX_SPOT_FOV = 3.1 as const;

/**
 * World-space forward axis (−Z basis column) of a column-major transform,
 * normalized into `out`. Mirrors `forwardFromMatrix` but yields a `Vec3`.
 */
const forwardOf = (m: Mat4, out: Float32Array): Float32Array => {
  vec3.set(-(m[8] as number), -(m[9] as number), -(m[10] as number), out);
  return vec3.normalize(out, out);
};

/** A world-up that is not (near-)parallel to `forward`, for `lookAt`. */
const upFor = (forward: Float32Array): Float32Array =>
  Math.abs(forward[1] as number) > 0.99 ? vec3.create(0, 0, 1) : vec3.create(0, 1, 0);

/**
 * Build the light-space view-projection for a directional light into `out`
 * (column-major). The frustum is a fixed orthographic box of half-extent
 * `settings.directionalExtent` centered on the world origin, aimed along the
 * light's forward (−Z of `gtMatrix`). Positionless: only the rotation matters.
 *
 * @returns `out`, for chaining.
 */
export const directionalLightViewProj = (
  gtMatrix: Mat4,
  settings: Shadow3dSettings,
  out: Mat4,
): Mat4 => {
  const forward = forwardOf(gtMatrix, scratchForward);
  // Place the eye behind the origin so the [near, far] slab straddles it.
  vec3.scale(forward, -settings.far * 0.5, scratchEye);
  const view = mat4.lookAt(scratchEye, ORIGIN, upFor(forward), scratchView);
  const ext = settings.directionalExtent;
  const proj = mat4.ortho(-ext, ext, -ext, ext, settings.near, settings.far, scratchProj);
  return mat4.multiply(proj, view, out) as Mat4;
};

/**
 * Build the light-space view-projection for a spot light into `out`
 * (column-major). A perspective frustum at the light's world position, aimed
 * along its forward (−Z of `gtMatrix`), with vertical FOV `2·outerAngle` and
 * far plane at the light's `range`.
 *
 * @returns `out`, for chaining.
 */
export const spotLightViewProj = (
  gtMatrix: Mat4,
  outerAngle: number,
  range: number,
  settings: Shadow3dSettings,
  out: Mat4,
): Mat4 => {
  const forward = forwardOf(gtMatrix, scratchForward);
  vec3.set(gtMatrix[12] as number, gtMatrix[13] as number, gtMatrix[14] as number, scratchEye);
  vec3.add(scratchEye, forward, scratchTarget);
  const view = mat4.lookAt(scratchEye, scratchTarget, upFor(forward), scratchView);
  const fovy = Math.min(Math.max(2 * outerAngle, 0.01), MAX_SPOT_FOV);
  const far = Math.max(range, settings.near + 0.01);
  const proj = mat4.perspective(fovy, 1, settings.near, far, scratchProj);
  return mat4.multiply(proj, view, out) as Mat4;
};

/**
 * Assign the next free shadow-atlas layer to a caster, or
 * {@link NO_SHADOW_CASTER} when the per-frame budget
 * ({@link MAX_SHADOW_CASTERS}) is exhausted. `nextLayer` is the count of
 * casters already assigned this frame.
 */
export const assignCasterLayer = (nextLayer: number): number =>
  nextLayer < MAX_SHADOW_CASTERS ? nextLayer : NO_SHADOW_CASTER;
