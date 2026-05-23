import { Transform } from '../transform';
import {
  Camera,
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
  hdr?: boolean;
  msaaWriteback?: boolean;
  clearColor?: ClearColorConfig;
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
    ...(options.hdr !== undefined ? { hdr: options.hdr } : {}),
    ...(options.msaaWriteback !== undefined ? { msaaWriteback: options.msaaWriteback } : {}),
    ...(options.clearColor !== undefined ? { clearColor: options.clearColor } : {}),
  });

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
export const Camera2d = (options: Camera2dOptions = {}): readonly object[] => [
  buildCamera(options),
  new OrthographicProjection({
    near: -1000,
    far: 1000,
    scalingMode: ScalingMode.WindowSize,
    ...options.projection,
  }),
  options.transform ?? new Transform(),
];

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
export const Camera3d = (options: Camera3dOptions = {}): readonly object[] => [
  buildCamera(options),
  new PerspectiveProjection(options.projection),
  options.transform ?? new Transform(),
];
