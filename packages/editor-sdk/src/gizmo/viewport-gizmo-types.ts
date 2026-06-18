import type { Mat4 } from '@retro-engine/math';

import type { Srgb8, Vec2 } from '../units';

/**
 * One of the nine anchor positions for the orientation gizmo within its
 * viewport, combining a vertical and horizontal edge (e.g. `top-right`).
 */
export type ViewportGizmoPlacement =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'center-left'
  | 'center-center'
  | 'center-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right';

/** A world axis and direction the user picked by clicking its ball. */
export interface AxisPick {
  /** The axis the ball belongs to. */
  readonly axis: 'x' | 'y' | 'z';
  /** `+1` for the positive (labelled) ball, `-1` for the negative one. */
  readonly sign: 1 | -1;
}

/** Per-axis appearance. A `null` color falls back to the theme's axis color. */
export interface ViewportAxisStyle {
  /** Ball fill color, or `null` to use the palette axis color (X red, Y green, Z cyan). */
  color: Srgb8 | null;
  /** Text drawn on the positive ball; the empty string hides it. */
  label: string;
  /** Label color, or `null` to use a dark token for contrast on the bright ball. */
  labelColor: Srgb8 | null;
}

/**
 * Full appearance + behavior configuration for the {@link ViewportGizmo}. Every
 * field is concrete (no optionals) so a single object is the live source of
 * truth — mutate it to restyle the gizmo without rebuilding anything. Use
 * {@link defaultViewportGizmoOptions} to get a populated instance to tweak.
 */
export interface ViewportGizmoOptions {
  /** Widget diameter in pixels. */
  size: number;
  /** Anchor corner/edge within the viewport. */
  placement: ViewportGizmoPlacement;
  /** Inset from the viewport edges in pixels. */
  offset: number;
  /** Animate camera alignment when a ball is clicked, vs. snapping instantly. */
  animated: boolean;
  /** Alignment animation speed multiplier (higher is faster). */
  speed: number;
  /** Promote a 2D (orthographic) view to 3D when the gizmo is dragged or an off-axis ball is clicked. */
  exit2dOnInteract: boolean;
  /** Pointer travel (px) past which a press becomes a drag rather than a click. */
  clickThresholdPx: number;
  /** Axis line thickness in pixels. */
  lineWidth: number;
  /** Positive ball radius in pixels. */
  ballRadius: number;
  /** Negative ball radius as a fraction of {@link ballRadius}. */
  negativeBallScale: number;
  /** Hovered ball radius multiplier. */
  hoverScale: number;
  /** Background disc. */
  background: {
    /** Disc color, or `null` to use a neutral palette token. */
    color: Srgb8 | null;
    /** Disc opacity when idle (0 hides it until hover). */
    opacity: number;
    /** Disc opacity while hovered or dragging. */
    hoverOpacity: number;
  };
  /** Label font size in pixels. */
  font: { size: number };
  /** Positive/negative X axis appearance. */
  x: ViewportAxisStyle;
  /** Positive/negative Y axis appearance. */
  y: ViewportAxisStyle;
  /** Positive/negative Z axis appearance. */
  z: ViewportAxisStyle;
}

/**
 * A populated {@link ViewportGizmoOptions} matching the three.js-style sphere
 * look (labelled colored balls, lines from the center, a disc that appears on
 * hover). Axis and disc colors are left `null` so they resolve from the active
 * theme palette at draw time. Returns a fresh object each call.
 */
export const defaultViewportGizmoOptions = (): ViewportGizmoOptions => ({
  size: 104,
  placement: 'top-right',
  offset: 12,
  animated: true,
  speed: 1,
  exit2dOnInteract: true,
  clickThresholdPx: 6,
  lineWidth: 2,
  ballRadius: 12,
  negativeBallScale: 0.62,
  hoverScale: 1.18,
  background: { color: null, opacity: 0, hoverOpacity: 0.22 },
  font: { size: 12 },
  x: { color: null, label: 'X', labelColor: null },
  y: { color: null, label: 'Y', labelColor: null },
  z: { color: null, label: 'Z', labelColor: null },
});

/** Per-frame input the host gathers for {@link ViewportGizmo.update}. */
export interface ViewportGizmoInput {
  /** The viewport rect (screen px) the gizmo anchors itself within. */
  readonly viewport: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  /** The editor camera's world→view matrix; its rotation orients the axes. */
  readonly viewMatrix: Mat4;
  /** Whether the viewport is hovered — gates starting a new interaction. */
  readonly hovered: boolean;
  /** Pointer state in screen pixels (global), matching the viewport rect space. */
  readonly pointer: {
    readonly position: Vec2;
    readonly down: boolean;
    readonly pressed: boolean;
    readonly released: boolean;
  };
}

/** Intents produced by {@link ViewportGizmo.update} for the host to apply. */
export interface ViewportGizmoOutput {
  /** Pointer is over the disc or a drag is in progress — suppress viewport nav/picking. */
  readonly active: boolean;
  /** Orbit deltas (radians) to apply this frame while dragging, else `null`. */
  readonly orbit: { readonly dYaw: number; readonly dPitch: number } | null;
  /** The axis the user clicked to align the view to, else `null`. */
  readonly pick: AxisPick | null;
}
