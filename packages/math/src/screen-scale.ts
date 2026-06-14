import type { Mat4, Vec3 } from 'wgpu-matrix';

/** Below this clip-space `w` the pivot is at/behind the camera; scale is undefined. */
const EPSILON = 1e-6;

/**
 * World-space length that projects to roughly `desiredPixels` of vertical
 * screen space at `pivotWorld`, for a camera with the given `viewProj`
 * (`projection * view`) and a viewport `viewportHeightPx` pixels tall.
 *
 * Multiply gizmo handle dimensions by this factor each frame to keep them a
 * constant on-screen size regardless of camera distance: under perspective the
 * factor grows with distance to cancel foreshortening; under an orthographic
 * projection it is distance-independent, as expected.
 *
 * Derivation: a small world displacement `δ` shifts clip-space `y` by
 * `(∂clipY/∂world · δ) / w`, and NDC spans `[-1, 1]` over the viewport height,
 * so one world unit covers `‖∂clipY/∂world‖ / |w|` of half the height. Inverting
 * for the length that covers `desiredPixels` gives the factor below. Using the
 * clip-Y gradient (rather than a `tan(fov)` form) keeps it projection-agnostic,
 * so it stays correct for an orthographic editor camera.
 */
export const screenSpaceScale = (
  pivotWorld: Vec3,
  viewProj: Mat4,
  viewportHeightPx: number,
  desiredPixels: number,
): number => {
  const px = pivotWorld[0]!;
  const py = pivotWorld[1]!;
  const pz = pivotWorld[2]!;
  // Column-major: clip-Y gradient w.r.t. world is row 1 = (m[1], m[5], m[9]);
  // clip-W is row 3 = (m[3], m[7], m[11], m[15]).
  const gx = viewProj[1]!;
  const gy = viewProj[5]!;
  const gz = viewProj[9]!;
  const w = viewProj[3]! * px + viewProj[7]! * py + viewProj[11]! * pz + viewProj[15]!;
  const absW = Math.abs(w);
  if (absW < EPSILON) return 0;
  const ndcPerWorld = Math.sqrt(gx * gx + gy * gy + gz * gz) / absW;
  if (ndcPerWorld < EPSILON) return 0;
  const gizmoNdc = (2 * desiredPixels) / viewportHeightPx;
  return gizmoNdc / ndcPerWorld;
};
