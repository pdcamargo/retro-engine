import { Core3dLabel } from '../render-graph/core-3d';
import type { RenderLabel } from '../render-graph/render-label';
import { DEFAULT_TONEMAPPING_METHOD, Tonemapping, type TonemappingMethod } from '../tonemapping/tonemapping';
import { Transform } from '../transform';
import {
  Camera,
  CameraDepthTarget,
  CameraRenderTarget,
  ClearColorConfig,
  type Viewport,
} from './camera';
import {
  OrthographicProjection,
  PerspectiveProjection,
  ScalingMode,
} from './projection';

interface BaseCameraOptions {
  isActive?: boolean;
  order?: number;
  viewport?: Viewport;
  target?: CameraRenderTarget;
  /**
   * Depth attachment for the camera. `Camera2d()` defaults to
   * `CameraDepthTarget.None`; `Camera3d()` defaults to
   * `CameraDepthTarget.auto()`. Override to set a custom format or to share a
   * manually-managed depth view.
   */
  depthTarget?: CameraDepthTarget;
  hdr?: boolean;
  msaaWriteback?: boolean;
  clearColor?: ClearColorConfig;
  /**
   * Sub-graph this camera dispatches into. Defaults to `Core2dLabel` for
   * `Camera2d` and `Core3dLabel` for `Camera3d` — override only if your
   * plugin registered a custom sub-graph.
   */
  subGraph?: RenderLabel;
  /**
   * When the camera is HDR (`hdr: true`), the bundle inserts a default
   * {@link Tonemapping} component with method
   * {@link DEFAULT_TONEMAPPING_METHOD}. Pass an explicit `TonemappingMethod`
   * here to override the operator; pass `'none'` for a passthrough; pass
   * `false` to opt out of the auto-insert entirely (the camera will then
   * render HDR-clipped output unless you spawn a `Tonemapping` component
   * yourself). When `hdr: false`, this option is ignored — there is no
   * HDR signal for a tonemap to consume.
   */
  tonemapping?: TonemappingMethod | false;
  /** Optional initial `Transform`. Defaults to identity. */
  transform?: Transform;
}

/** Options for {@link Camera2d}. Projection overrides accept the same shape as `new OrthographicProjection({...})`. */
export interface Camera2dOptions extends BaseCameraOptions {
  projection?: Partial<{
    near: number;
    far: number;
    viewportOrigin: { x: number; y: number };
    scalingMode: ScalingMode;
    scale: number;
  }>;
}

/** Options for {@link Camera3d}. Projection overrides accept the same shape as `new PerspectiveProjection({...})`. */
export interface Camera3dOptions extends BaseCameraOptions {
  projection?: Partial<{ fov: number; near: number; far: number }>;
}

const buildCamera = (options: BaseCameraOptions): Camera =>
  new Camera({
    ...(options.isActive !== undefined ? { isActive: options.isActive } : {}),
    ...(options.order !== undefined ? { order: options.order } : {}),
    ...(options.viewport !== undefined ? { viewport: options.viewport } : {}),
    ...(options.target !== undefined ? { target: options.target } : {}),
    ...(options.depthTarget !== undefined ? { depthTarget: options.depthTarget } : {}),
    ...(options.hdr !== undefined ? { hdr: options.hdr } : {}),
    ...(options.msaaWriteback !== undefined ? { msaaWriteback: options.msaaWriteback } : {}),
    ...(options.clearColor !== undefined ? { clearColor: options.clearColor } : {}),
    ...(options.subGraph !== undefined ? { subGraph: options.subGraph } : {}),
  });

/**
 * Resolve the bundle's `tonemapping` option into the optional `Tonemapping`
 * component to insert. Returns `undefined` for non-HDR cameras (no
 * tonemap), for HDR cameras with `tonemapping: false` (explicit opt-out),
 * and otherwise builds a `Tonemapping` carrying the requested method or
 * {@link DEFAULT_TONEMAPPING_METHOD} when none was passed.
 */
const buildTonemapping = (options: BaseCameraOptions): Tonemapping | undefined => {
  if (options.hdr !== true) return undefined;
  if (options.tonemapping === false) return undefined;
  return new Tonemapping({
    method: options.tonemapping ?? DEFAULT_TONEMAPPING_METHOD,
  });
};

/**
 * Factory for a 2D camera, returning a tuple of components ready to pass to
 * `spawn(...)`. Pairs a `Camera` (default target = primary surface,
 * `ClearColorConfig.Default`) with an `OrthographicProjection` configured for
 * 2D use — `near: -1000`, `far: 1000`, `scalingMode: WindowSize` — and a
 * default identity `Transform`.
 *
 * @example
 * ```ts
 * import { Camera2d, ClearColorConfig } from '@retro-engine/engine';
 *
 * // Spawn at startup. Spread the tuple into the spawn call (or pass the array directly).
 * cmd.spawn(...Camera2d());
 *
 * // Customize:
 * cmd.spawn(
 *   ...Camera2d({
 *     order: 1,
 *     clearColor: ClearColorConfig.custom({ r: 0.1, g: 0.1, b: 0.12, a: 1 }),
 *     projection: { scale: 2 },
 *   }),
 * );
 * ```
 */
export const Camera2d = (options: Camera2dOptions = {}): readonly object[] => {
  const tonemapping = buildTonemapping(options);
  return [
    buildCamera(options),
    new OrthographicProjection({
      near: -1000,
      far: 1000,
      scalingMode: ScalingMode.WindowSize,
      ...options.projection,
    }),
    options.transform ?? new Transform(),
    ...(tonemapping !== undefined ? [tonemapping] : []),
  ];
};

/**
 * Factory for a 3D camera, returning a tuple of components ready to pass to
 * `spawn(...)`. Pairs a `Camera` (default target = primary surface,
 * `ClearColorConfig.Default`) with a `PerspectiveProjection` — `fov: π/4`,
 * `near: 0.1`, `far: 1000` — and a default identity `Transform`.
 *
 * @example
 * ```ts
 * import { Camera3d } from '@retro-engine/engine';
 * import { quat, vec3 } from '@retro-engine/math';
 *
 * cmd.spawn(
 *   ...Camera3d({
 *     projection: { fov: Math.PI / 3 },
 *     transform: new Transform(vec3.create(0, 2, 5), quat.identity()),
 *   }),
 * );
 * ```
 */
export const Camera3d = (options: Camera3dOptions = {}): readonly object[] => {
  const tonemapping = buildTonemapping(options);
  return [
    // `Camera3d()` defaults to an engine-allocated depth attachment so 3D draws
    // resolve depth correctly without manual texture management. The consumer
    // can override via `options.depthTarget`.
    buildCamera({ subGraph: Core3dLabel, depthTarget: CameraDepthTarget.auto(), ...options }),
    new PerspectiveProjection(options.projection),
    options.transform ?? new Transform(),
    ...(tonemapping !== undefined ? [tonemapping] : []),
  ];
};
