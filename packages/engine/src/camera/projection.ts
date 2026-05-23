import type { Mat4 } from '@retro-engine/math';
import { mat4 } from '@retro-engine/math';

/**
 * How an {@link OrthographicProjection} scales to fit the camera's target.
 *
 * - `WindowSize` — one world unit equals one physical pixel of the target.
 *   Convenient for pixel-art games at integer scale.
 * - `Fixed` — the visible world rect is exactly `width × height` regardless
 *   of target aspect; non-matching aspect stretches.
 * - `AutoMin` — keeps the target's aspect, sized so at least
 *   `minWidth × minHeight` world units are visible.
 * - `AutoMax` — keeps the target's aspect, sized so at most
 *   `maxWidth × maxHeight` world units are visible.
 * - `FixedVertical` — vertical extent is `viewportHeight` world units; horizontal
 *   extent follows the target aspect.
 * - `FixedHorizontal` — horizontal extent is `viewportWidth` world units; vertical
 *   extent follows the target aspect.
 *
 * All world-unit values are pre-`scale` — the projection's `scale` field is a
 * uniform multiplier applied on top.
 */
export type ScalingMode =
  | { readonly kind: 'windowSize' }
  | { readonly kind: 'fixed'; readonly width: number; readonly height: number }
  | { readonly kind: 'autoMin'; readonly minWidth: number; readonly minHeight: number }
  | { readonly kind: 'autoMax'; readonly maxWidth: number; readonly maxHeight: number }
  | { readonly kind: 'fixedVertical'; readonly viewportHeight: number }
  | { readonly kind: 'fixedHorizontal'; readonly viewportWidth: number };

export const ScalingMode = {
  /** One world unit = one physical pixel of the target. */
  WindowSize: Object.freeze<ScalingMode>({ kind: 'windowSize' }),
  fixed(width: number, height: number): ScalingMode {
    return { kind: 'fixed', width, height };
  },
  autoMin(minWidth: number, minHeight: number): ScalingMode {
    return { kind: 'autoMin', minWidth, minHeight };
  },
  autoMax(maxWidth: number, maxHeight: number): ScalingMode {
    return { kind: 'autoMax', maxWidth, maxHeight };
  },
  fixedVertical(viewportHeight: number): ScalingMode {
    return { kind: 'fixedVertical', viewportHeight };
  },
  fixedHorizontal(viewportWidth: number): ScalingMode {
    return { kind: 'fixedHorizontal', viewportWidth };
  },
} as const;

/**
 * Standard 3D perspective projection. Attached to a `Camera` entity alongside
 * a `Camera` component to define the camera's view-to-clip transform.
 *
 * `fov` is the *vertical* field-of-view in radians. `aspectRatio` is overwritten
 * each frame by the camera system from the target's physical dimensions —
 * setting it manually is a no-op.
 *
 * Default-constructed: `fov = π/4` (45°), `near = 0.1`, `far = 1000`.
 */
export class PerspectiveProjection {
  /** Vertical field of view in radians. Default π/4 (45°). */
  fov: number;
  /** Distance to the near clip plane in world units. Default `0.1`. */
  near: number;
  /** Distance to the far clip plane in world units. Default `1000`. */
  far: number;
  /** Target width-over-height ratio. Written by the camera system; gameplay code does not set this. */
  aspectRatio: number;

  constructor(options: Partial<{ fov: number; near: number; far: number; aspectRatio: number }> = {}) {
    this.fov = options.fov ?? Math.PI / 4;
    this.near = options.near ?? 0.1;
    this.far = options.far ?? 1000;
    this.aspectRatio = options.aspectRatio ?? 1;
  }
}

/**
 * Standard 2D / orthographic projection. Attached to a `Camera` entity alongside
 * a `Camera` component to define the camera's view-to-clip transform.
 *
 * The visible world rect is computed each frame from the target's physical
 * dimensions and the chosen {@link ScalingMode}, then offset by
 * `viewportOrigin` and scaled by `scale`. The default origin `(0.5, 0.5)`
 * centers the rect on the camera entity's translation.
 *
 * Default-constructed (3D-style): `near = 0`, `far = 1000`,
 * `scalingMode = WindowSize`, `scale = 1`, `viewportOrigin = (0.5, 0.5)`.
 *
 * `Camera2d` overrides `near = -1000` so 2D sprites at negative Z (behind the
 * camera origin) remain visible.
 */
export class OrthographicProjection {
  /** Distance to the near clip plane. May be negative for 2D usage. Default `0`. */
  near: number;
  /** Distance to the far clip plane. Default `1000`. */
  far: number;
  /**
   * Normalized origin within the projected rect, in `[0, 1] × [0, 1]`.
   * `(0.5, 0.5)` centers the rect; `(0, 0)` puts the camera position at the
   * top-left corner of the visible area.
   */
  viewportOrigin: { x: number; y: number };
  /** How the projection sizes itself against the target. */
  scalingMode: ScalingMode;
  /** Uniform scale multiplier applied on top of {@link scalingMode}. Default `1`. */
  scale: number;
  /**
   * Cached visible-rect bounds (world units), recomputed each frame by the
   * camera system. `gameplay` code reads it; do not write to it.
   */
  area: { minX: number; minY: number; maxX: number; maxY: number };

  constructor(
    options: Partial<{
      near: number;
      far: number;
      viewportOrigin: { x: number; y: number };
      scalingMode: ScalingMode;
      scale: number;
    }> = {},
  ) {
    this.near = options.near ?? 0;
    this.far = options.far ?? 1000;
    this.viewportOrigin = options.viewportOrigin ?? { x: 0.5, y: 0.5 };
    this.scalingMode = options.scalingMode ?? ScalingMode.WindowSize;
    this.scale = options.scale ?? 1;
    this.area = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }
}

/**
 * Compute a perspective projection matrix in-place. Column-major, depth range
 * `[0, 1]` (matching WebGPU's clip-space convention).
 *
 * Delegates to `wgpu-matrix`'s `mat4.perspective`. Aspect ratio is read off the
 * projection; the caller is responsible for keeping it in sync with the
 * target's dimensions (the engine's camera system does this each frame).
 *
 * @param out  Destination matrix (column-major `Float32Array`).
 * @param proj Perspective projection component to read parameters from.
 * @returns    `out`, for chaining.
 */
export const buildPerspectiveMatrix = (out: Mat4, proj: PerspectiveProjection): Mat4 => {
  return mat4.perspective(proj.fov, proj.aspectRatio, proj.near, proj.far, out);
};

/**
 * Compute the orthographic projection's visible-rect bounds against a target
 * of size `targetWidth × targetHeight` (physical pixels). The result is
 * written into `proj.area`.
 *
 * The math mirrors the {@link ScalingMode} variants:
 *
 * - `WindowSize` — area = `targetWidth × targetHeight` world units.
 * - `Fixed { width, height }` — area = `width × height` world units, aspect
 *   may not match the target.
 * - `AutoMin { minWidth, minHeight }` — keep the target's aspect, area at
 *   least `minWidth × minHeight`.
 * - `AutoMax { maxWidth, maxHeight }` — keep the target's aspect, area at
 *   most `maxWidth × maxHeight`.
 * - `FixedVertical { viewportHeight }` — vertical extent fixed, horizontal
 *   from target aspect.
 * - `FixedHorizontal { viewportWidth }` — horizontal extent fixed, vertical
 *   from target aspect.
 *
 * The result is then offset by `proj.viewportOrigin` (which determines where
 * the area sits relative to the camera position) and scaled uniformly by
 * `proj.scale`.
 */
export const updateOrthographicArea = (
  proj: OrthographicProjection,
  targetWidth: number,
  targetHeight: number,
): void => {
  const aspect = targetHeight > 0 ? targetWidth / targetHeight : 1;
  let width: number;
  let height: number;
  switch (proj.scalingMode.kind) {
    case 'windowSize': {
      width = targetWidth;
      height = targetHeight;
      break;
    }
    case 'fixed': {
      width = proj.scalingMode.width;
      height = proj.scalingMode.height;
      break;
    }
    case 'autoMin': {
      // Choose ratio so at least minWidth × minHeight is visible; keep target aspect.
      const { minWidth, minHeight } = proj.scalingMode;
      const wRatio = minWidth > 0 ? targetWidth / minWidth : Infinity;
      const hRatio = minHeight > 0 ? targetHeight / minHeight : Infinity;
      const ratio = Math.min(wRatio, hRatio);
      width = ratio > 0 ? targetWidth / ratio : minWidth;
      height = ratio > 0 ? targetHeight / ratio : minHeight;
      break;
    }
    case 'autoMax': {
      const { maxWidth, maxHeight } = proj.scalingMode;
      const wRatio = maxWidth > 0 ? targetWidth / maxWidth : 0;
      const hRatio = maxHeight > 0 ? targetHeight / maxHeight : 0;
      const ratio = Math.max(wRatio, hRatio);
      width = ratio > 0 ? targetWidth / ratio : maxWidth;
      height = ratio > 0 ? targetHeight / ratio : maxHeight;
      break;
    }
    case 'fixedVertical': {
      height = proj.scalingMode.viewportHeight;
      width = height * aspect;
      break;
    }
    case 'fixedHorizontal': {
      width = proj.scalingMode.viewportWidth;
      height = aspect > 0 ? width / aspect : 0;
      break;
    }
  }
  const w = width * proj.scale;
  const h = height * proj.scale;
  const minX = -w * proj.viewportOrigin.x;
  const minY = -h * proj.viewportOrigin.y;
  proj.area.minX = minX;
  proj.area.minY = minY;
  proj.area.maxX = minX + w;
  proj.area.maxY = minY + h;
};

/**
 * Compute an orthographic projection matrix in-place from
 * {@link OrthographicProjection.area}. Call {@link updateOrthographicArea}
 * first to bring `area` in sync with the camera's target size. Column-major,
 * depth range `[0, 1]` (WebGPU convention).
 */
export const buildOrthographicMatrix = (out: Mat4, proj: OrthographicProjection): Mat4 => {
  const { minX, maxX, minY, maxY } = proj.area;
  return mat4.ortho(minX, maxX, minY, maxY, proj.near, proj.far, out);
};
