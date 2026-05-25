import type { Color, Mat4, Vec3 } from '@retro-engine/math';
import { Frustum, mat4, vec3 } from '@retro-engine/math';
import type {
  BindGroup,
  Buffer,
  ResolvedRenderTarget,
  Surface,
  Texture,
  TextureFormat,
  TextureView,
  TextureViewDescriptor,
} from '@retro-engine/renderer-core';

import { Core2dLabel } from '../render-graph/core-2d';
import type { RenderLabel } from '../render-graph/render-label';

/**
 * Per-camera sub-rect of the render target. All values are physical pixels
 * (not logical CSS pixels) — multiply by `devicePixelRatio` if you have
 * logical coordinates.
 *
 * Omit `viewport` on a `Camera` to render to the entire target; supply one
 * to letterbox, split-screen, render a minimap, or composite multiple
 * cameras into one target by `order`.
 */
export interface Viewport {
  /** Top-left corner of the viewport within the target, in physical pixels. */
  physicalPosition: { x: number; y: number };
  /** Viewport dimensions, in physical pixels. */
  physicalSize: { width: number; height: number };
  /** Depth slice mapped to `[0, 1]` of the target's depth buffer. */
  depth: { min: number; max: number };
}

/**
 * How a camera clears its target before drawing.
 *
 * - `Default` — read the global {@link ClearColor} resource.
 * - `Custom(color)` — clear to `color`.
 * - `None` — do not clear; the camera composites over whatever the target
 *   already contains (the previous frame, an earlier camera's output, …).
 *
 * Built via the helper functions on {@link ClearColorConfig} below.
 */
export type ClearColorConfig =
  | { readonly kind: 'default' }
  | { readonly kind: 'custom'; readonly color: Color }
  | { readonly kind: 'none' };

export const ClearColorConfig = {
  /** Read the global {@link ClearColor} resource. */
  Default: Object.freeze<ClearColorConfig>({ kind: 'default' }),
  /** Do not clear; preserve the target's existing contents. */
  None: Object.freeze<ClearColorConfig>({ kind: 'none' }),
  /** Clear to the supplied color. */
  custom(color: Color): ClearColorConfig {
    return { kind: 'custom', color };
  },
} as const;

/**
 * Where a {@link Camera} draws to. Engine-level superset of
 * `renderer-core`'s {@link import('@retro-engine/renderer-core').RenderTarget RenderTarget};
 * adds the `{ kind: 'primary' }` sentinel that resolves to the App's main
 * surface at frame time, so callers do not have to thread the surface through
 * to spawn-time.
 *
 * - `{ kind: 'primary' }` — the App's primary swapchain (the canvas).
 *   Default for `Camera2d` / `Camera3d`. A camera with this target on a
 *   headless App (no canvas) is dropped at sort time with a one-shot warning.
 * - `{ kind: 'surface' }` — an explicit surface (e.g. a secondary canvas).
 * - `{ kind: 'texture' }` — render to an offscreen texture; later cameras can
 *   sample it.
 * - `{ kind: 'view' }` — render to a pre-built texture view.
 */
export type CameraRenderTarget =
  | { readonly kind: 'primary' }
  | { readonly kind: 'surface'; readonly surface: Surface }
  | {
      readonly kind: 'texture';
      readonly texture: Texture;
      readonly viewDescriptor?: TextureViewDescriptor;
    }
  | {
      readonly kind: 'view';
      readonly view: TextureView;
      readonly format: TextureFormat;
      readonly width: number;
      readonly height: number;
    };

export const CameraRenderTarget = {
  /** The App's primary swapchain. Resolved at frame time. */
  Primary: Object.freeze<CameraRenderTarget>({ kind: 'primary' }),
  surface(surface: Surface): CameraRenderTarget {
    return { kind: 'surface', surface };
  },
  texture(texture: Texture, viewDescriptor?: TextureViewDescriptor): CameraRenderTarget {
    return viewDescriptor !== undefined
      ? { kind: 'texture', texture, viewDescriptor }
      : { kind: 'texture', texture };
  },
  view(
    view: TextureView,
    format: TextureFormat,
    width: number,
    height: number,
  ): CameraRenderTarget {
    return { kind: 'view', view, format, width, height };
  },
} as const;

/**
 * Per-camera depth attachment declaration.
 *
 * - `'auto'` — the engine allocates a depth texture matching the camera's
 *   color-target size and `format` (defaults to `'depth32float'`; opt into a
 *   stencil-bearing format by setting `format: 'depth24plus-stencil8'`).
 *   The texture is owned and lifecycle-managed by the `ViewDepthCache` render-
 *   world resource. This is the `Camera3d()` factory default.
 * - `'none'` — the camera draws with no depth attachment. Suitable for 2D
 *   compositing. This is the `Camera2d()` factory default.
 * - `{ kind: 'manual', view, format }` — the consumer provides the depth
 *   texture view. The engine does not allocate or resize.
 */
export type CameraDepthTarget =
  | { readonly kind: 'auto'; readonly format?: TextureFormat }
  | { readonly kind: 'none' }
  | { readonly kind: 'manual'; readonly view: TextureView; readonly format: TextureFormat };

export const CameraDepthTarget = {
  /** Engine-allocated depth texture. Default `'depth32float'`. */
  auto(format?: TextureFormat): CameraDepthTarget {
    return format !== undefined ? { kind: 'auto', format } : { kind: 'auto' };
  },
  /** No depth attachment. */
  None: Object.freeze<CameraDepthTarget>({ kind: 'none' }),
  /** Consumer-managed depth view; format must match a depth/depth-stencil aspect. */
  manual(view: TextureView, format: TextureFormat): CameraDepthTarget {
    return { kind: 'manual', view, format };
  },
} as const;

/**
 * Cached per-frame values written by the camera system in `'postUpdate'` (or
 * the prepare-cameras step on the render side). Consumers read these rather
 * than recomputing each frame.
 *
 * `targetSize` is the *target's* physical dimensions, not the viewport's
 * — the projection takes the full target into account, the viewport just
 * scissors the draw.
 */
export interface ComputedCamera {
  /** Physical-pixel size of the camera's target, snapshot for the current frame. */
  targetSize: { width: number; height: number };
  /** World-to-view matrix (inverse of the camera entity's `GlobalTransform`). */
  viewMatrix: Mat4;
  /** View-to-clip matrix produced by the camera's projection. */
  projectionMatrix: Mat4;
  /** Pre-multiplied `projectionMatrix * viewMatrix`. */
  viewProjectionMatrix: Mat4;
  /** Camera world-space position (translation column of `GlobalTransform`). */
  worldPosition: Vec3;
}

const defaultComputed = (): ComputedCamera => ({
  targetSize: { width: 0, height: 0 },
  viewMatrix: mat4.identity(),
  projectionMatrix: mat4.identity(),
  viewProjectionMatrix: mat4.identity(),
  worldPosition: vec3.create(0, 0, 0),
});

/**
 * Camera component. Attach to an entity with a `Transform` to make it a
 * camera; the engine's camera system updates `computed` each frame against
 * the camera's `Projection*` companion (one of `PerspectiveProjection` or
 * `OrthographicProjection`) and `GlobalTransform`.
 *
 * The `Camera2d()` / `Camera3d()` factory helpers in
 * `@retro-engine/engine` return a pre-configured component array — prefer
 * them over constructing `Camera` directly unless you're customising every
 * field.
 *
 * @example
 * ```ts
 * import { Camera2d, ClearColorConfig } from '@retro-engine/engine';
 * cmd.spawn(...Camera2d({ order: 0, clearColor: ClearColorConfig.custom({ r: 0.1, g: 0.1, b: 0.12, a: 1 }) }));
 * ```
 */
export class Camera {
  /** When false, the camera is skipped during render-frame dispatch. */
  isActive: boolean;
  /** Cameras run in ascending `order`; ties break with off-screen targets first. */
  order: number;
  /** Optional sub-rect of the target. Undefined → full target. */
  viewport: Viewport | undefined;
  /** Where this camera draws. Default: the App's primary surface. */
  target: CameraRenderTarget;
  /**
   * Depth attachment for this camera's render passes. Default is
   * {@link CameraDepthTarget.None} — appropriate for 2D. `Camera3d()` defaults
   * to `{ kind: 'auto' }`, which has the engine allocate and manage a depth
   * texture matching the color target's size.
   */
  depthTarget: CameraDepthTarget;
  /** Enables HDR-format intermediate output. Honored by post-processing (Phase 12). */
  hdr: boolean;
  /** Whether earlier MSAA-resolved camera output should write through this camera's pass. */
  msaaWriteback: boolean;
  /** How this camera clears its target — `Default`, `Custom`, or `None`. */
  clearColor: ClearColorConfig;
  /**
   * Render-graph sub-graph that drives this camera. Resolved at frame time
   * by the `CameraDriverNode` to the matching {@link RenderSubGraph} on the
   * `RenderGraph`; built-ins are `Core2dLabel` (default) and `Core3dLabel`.
   * Plugins may register their own sub-graph and set this field to its
   * label. A camera with a sub-graph label that no plugin registered is
   * dropped at dispatch time with a one-shot dev warning.
   */
  subGraph: RenderLabel;
  /** Cached per-frame state; populated by the camera system, do not write from gameplay code. */
  computed: ComputedCamera;

  constructor(options: Partial<{
    isActive: boolean;
    order: number;
    viewport: Viewport;
    target: CameraRenderTarget;
    depthTarget: CameraDepthTarget;
    hdr: boolean;
    msaaWriteback: boolean;
    clearColor: ClearColorConfig;
    subGraph: RenderLabel;
  }> = {}) {
    this.isActive = options.isActive ?? true;
    this.order = options.order ?? 0;
    this.viewport = options.viewport;
    this.target = options.target ?? CameraRenderTarget.Primary;
    this.depthTarget = options.depthTarget ?? CameraDepthTarget.None;
    this.hdr = options.hdr ?? false;
    this.msaaWriteback = options.msaaWriteback ?? false;
    this.clearColor = options.clearColor ?? ClearColorConfig.Default;
    this.subGraph = options.subGraph ?? Core2dLabel;
    this.computed = defaultComputed();
  }

  /**
   * Required Components declaration: spawning an entity with `Camera`
   * auto-inserts a default-constructed `Frustum`. The visibility plugin
   * refreshes the frustum each `'postUpdate'` from the camera's computed
   * view-projection matrix; downstream culling reads it.
   */
  static readonly requires = [Frustum];
}

/**
 * Per-frame view handed to render-stage systems via {@link RenderCtx} and the
 * {@link Camera} system param. One instance is built per active camera each
 * frame; do not retain across frames.
 *
 * `viewBindGroup` is pre-bound to `@group(0)` of the current pass by the
 * engine before any Render-set system runs; render systems that consume the
 * view simply lay out `@group(0) @binding(0)` against it.
 */
export interface CameraView {
  /** Render-world entity owning the extracted camera for this frame. */
  readonly renderEntity: number;
  /** Main-world entity the camera was extracted from. */
  readonly sourceEntity: number;
  /** Mirrored from `Camera.order` for sort visibility. */
  readonly order: number;
  /** Resolved render target — backend view + format + dimensions. */
  readonly target: ResolvedRenderTarget;
  /**
   * Resolved depth attachment for this camera. `undefined` when the camera
   * was spawned with `CameraDepthTarget.None`. For `'auto'` cameras, the
   * `ViewDepthCache` (engine-owned) allocates a depth texture matching the
   * color target's dimensions; the view and format are mirrored here for the
   * Core3d phase nodes to attach without re-querying the cache.
   */
  readonly depth: { readonly view: TextureView; readonly format: TextureFormat } | undefined;
  /** Resolved viewport (defaults to the full target if `Camera.viewport` was undefined). */
  readonly viewport: Viewport;
  /** Final clear color — `undefined` when the camera was set to `ClearColorConfig.None`. */
  readonly clearColor: Color | undefined;
  /** `'clear'` when {@link clearColor} is set, `'load'` otherwise. */
  readonly loadOp: 'clear' | 'load';
  /** World-to-view matrix. */
  readonly viewMatrix: Mat4;
  /** View-to-clip matrix. */
  readonly projectionMatrix: Mat4;
  /** Pre-multiplied `projectionMatrix * viewMatrix`. */
  readonly viewProjectionMatrix: Mat4;
  /** Camera world-space position. */
  readonly worldPosition: Vec3;
  /** Render-layer mask the camera carries; bit `n` set ⇔ camera renders layer `n`. */
  readonly renderLayers: number;
  /** `@group(0)` view bind group, pre-bound on the pass before render systems run. */
  readonly viewBindGroup: BindGroup;
  /** Backing uniform buffer for {@link viewBindGroup}; engine-owned. */
  readonly viewBuffer: Buffer;
  /** Sub-graph label this camera dispatches into. Mirrored from `Camera.subGraph`. */
  readonly subGraph: RenderLabel;
}
