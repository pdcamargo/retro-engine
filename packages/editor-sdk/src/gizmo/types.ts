import type { Color, Mat4, Vec3 } from '@retro-engine/math';

/** Which transform a gizmo edits. `all` shows the move, rotate, and scale handles together. */
export type GizmoMode = 'move' | 'rotate' | 'scale' | 'all';

/**
 * The dimensionality the gizmo operates in. `3d` shows per-axis X/Y/Z handles;
 * `2d` restricts to the camera plane (X/Y translate + plane, Z rotate, X/Y +
 * uniform scale), matching an orthographic camera. The studio derives this from
 * the camera's projection.
 */
export type GizmoSpace = '2d' | '3d';

/** Identifies one interactive handle of a gizmo. */
export type GizmoHandle =
  | { readonly kind: 'move-axis'; readonly axis: 0 | 1 | 2 }
  | { readonly kind: 'move-plane'; readonly axis: 0 | 1 | 2 }
  | { readonly kind: 'move-screen' }
  | { readonly kind: 'rotate-axis'; readonly axis: 0 | 1 | 2 }
  | { readonly kind: 'rotate-screen' }
  | { readonly kind: 'scale-axis'; readonly axis: 0 | 1 | 2 }
  | { readonly kind: 'scale-uniform' };

/** The gizmo's interaction phase, returned from {@link TransformGizmo.update}. */
export type GizmoState =
  | { readonly phase: 'idle' }
  | { readonly phase: 'hover'; readonly handle: GizmoHandle }
  | { readonly phase: 'drag'; readonly handle: GizmoHandle; readonly cancelled: boolean };

/** Minimal camera view the gizmo needs — satisfied by an engine `Camera.computed`. */
export interface GizmoCamera {
  /** Pre-multiplied `projection * view`. */
  readonly viewProjectionMatrix: Mat4;
  /** Camera world-space position (used to face screen-aligned handles toward the viewer). */
  readonly worldPosition: Vec3;
  /** Render-target size in physical pixels. */
  readonly targetSize: { readonly width: number; readonly height: number };
}

/** A transform the gizmo mutates in place — satisfied by an engine `Transform`. */
export interface GizmoTarget {
  readonly translation: Vec3;
  readonly rotation: import('@retro-engine/math').Quat;
  readonly scale: Vec3;
}

/** Per-frame pointer + keyboard edges driving the gizmo, gathered by the host. */
export interface GizmoPointer {
  /** Cursor position relative to the viewport top-left, or `null` when outside. */
  readonly position: readonly [number, number] | null;
  /** Primary button held this frame. */
  readonly down: boolean;
  /** Primary button went down this frame (rising edge). */
  readonly pressed: boolean;
  /** Primary button went up this frame (falling edge). */
  readonly released: boolean;
  /** Cancel key (Escape) pressed this frame. */
  readonly cancel: boolean;
}

/** Everything {@link TransformGizmo.update} consumes for one frame. */
export interface GizmoInput {
  readonly camera: GizmoCamera;
  /** Viewport rect in the same pixel space as {@link GizmoPointer.position}. */
  readonly viewport: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  readonly pointer: GizmoPointer;
  readonly mode: GizmoMode;
  readonly space: GizmoSpace;
  /** Transforms to edit (≥1). Multiple targets move/rotate/scale about their shared centroid. */
  readonly targets: readonly GizmoTarget[];
}

/** Tunable sizes and colors. All optional; sensible defaults applied by the gizmo. */
export interface GizmoConfig {
  /** On-screen handle size target, in pixels. Default 90. */
  readonly pixelSize?: number;
  /** Pixel radius within which a handle is considered hovered. Default 9. */
  readonly hitTolerance?: number;
  /** Arc segment count for rotation rings. Default 48. */
  readonly arcSegments?: number;
}

/**
 * The subset of the engine `Gizmos` API the controller draws through. Declared
 * structurally so the controller does not hard-depend on the concrete class.
 */
export interface GizmosLike {
  line(a: Vec3, b: Vec3, color: Color, opts?: { layer?: number; depthTest?: boolean }): void;
  arrow(start: Vec3, end: Vec3, color: Color, headLength?: number, opts?: { layer?: number; depthTest?: boolean }): void;
  circle(
    center: Vec3,
    normal: Vec3,
    radius: number,
    color: Color,
    segments?: number,
    opts?: { layer?: number; depthTest?: boolean },
  ): void;
  cuboid(
    center: Vec3,
    halfExtents: Vec3,
    color: Color,
    rotation?: import('@retro-engine/math').Quat,
    opts?: { layer?: number; depthTest?: boolean },
  ): void;
}
