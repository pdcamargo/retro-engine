import { type Color, color } from '@retro-engine/math';

/**
 * Which plane the editor grid is drawn on.
 *
 * - `'xz'` — the horizontal ground plane (`y = planeHeight`), with a
 *   camera-distance radial fade. The plane a perspective 3D editor camera
 *   looks down onto.
 * - `'xy'` — the vertical work plane (`z = planeHeight`), sized to fill an
 *   orthographic view with no distance fade. The plane an orthographic 2D
 *   editor camera frames head-on.
 *
 * The grid pass renders whichever plane this selects, so an editor that
 * toggles its viewport between perspective (3D) and orthographic (2D) drives
 * this in step with the camera projection.
 */
export type GridPlane = 'xz' | 'xy';

/**
 * Configuration for the editor reference grid drawn on a ground plane.
 *
 * Inserted as an App resource by {@link GridPlugin}. Mutate its fields at any
 * time (e.g. from an editor settings panel) and the change takes effect the
 * next frame — the grid pass reads the live values every frame, so no
 * rebuild or re-registration is needed.
 *
 * The grid renders only for cameras whose render-layer mask includes the
 * editor gizmo layer (`EDITOR_GIZMO_LAYER`), so it appears in editor
 * viewports and never in a game camera's output.
 */
export class EditorGrid {
  /** Whether the grid is drawn at all. */
  enabled = true;

  /**
   * Which plane the grid is drawn on: the horizontal `'xz'` ground plane (for
   * a perspective 3D camera) or the vertical `'xy'` work plane (for an
   * orthographic 2D camera). A studio that toggles its viewport between 3D and
   * 2D drives this in step with the camera projection.
   */
  plane: GridPlane = 'xz';

  /** World-space Y the grid plane sits at. */
  planeHeight = 0;

  /** Spacing between adjacent minor lines, in world units (the tile size). */
  cellSize = 1;

  /**
   * How many cells make up one major division: a brighter major line is drawn
   * every `majorEvery` cells. `10` gives a major line each 10 tiles.
   */
  majorEvery = 10;

  /** Color of the thin minor (per-cell) lines. */
  minorColor: Color = color(0.45, 0.47, 0.52, 0.25);

  /** Color of the brighter major-division lines. */
  majorColor: Color = color(0.6, 0.63, 0.69, 0.5);

  /** Color of the world X axis (the `z = 0` line). */
  xAxisColor: Color = color(0.85, 0.27, 0.33, 0.85);

  /** Color of the world Z axis (the `x = 0` line). */
  zAxisColor: Color = color(0.3, 0.55, 0.9, 0.85);

  /**
   * Distance from the camera (in world units, measured on the plane) at which
   * the grid begins to fade out. Inside this radius the grid is fully opaque.
   */
  fadeStart = 30;

  /**
   * Distance from the camera at which the grid has fully faded to nothing. This
   * doubles as the grid's overall extent — geometry is generated out to this
   * radius, so beyond it there is nothing to draw. Smooth fade to this edge is
   * what keeps the grid clean at grazing/steep camera angles.
   */
  fadeEnd = 120;

  /**
   * Whether snap-to-grid is enabled. Carried here so a single settings object
   * drives both the visual grid and grid-snapping tools; the grid renderer
   * itself ignores this field.
   */
  snapEnabled = true;

  /**
   * Snap increment in world units when {@link snapEnabled} is set. Consumed by
   * snapping tools, not by the grid renderer.
   */
  snapStep = 1;
}
