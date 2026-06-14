/**
 * Render layer reserved for editor-only gizmos — transform handles, the editor
 * grid, selection outlines, anything that must appear in an editor viewport but
 * never in the running game's view.
 *
 * A camera renders gizmos on this layer only when its `RenderLayers` mask
 * includes the bit: editor cameras opt in with
 * `RenderLayers.layers(0, EDITOR_GIZMO_LAYER)`, while game cameras keep the
 * default mask and so draw nothing emitted on it. This is the engine's
 * supported mechanism for separating editor visuals from game visuals.
 */
export const EDITOR_GIZMO_LAYER = 31 as const;

/** Bit mask for {@link EDITOR_GIZMO_LAYER}, ready to OR into a `RenderLayers` mask. */
export const EDITOR_GIZMO_MASK = ((1 << EDITOR_GIZMO_LAYER) >>> 0) as number;

/** Default render-layer mask (layer 0) — gizmos every camera draws. */
export const DEFAULT_GIZMO_MASK = 0b1 as const;

/**
 * Floats per gizmo line vertex: 3 position + 4 color. Two vertices make one
 * line segment in the `line-list` vertex buffer.
 */
export const GIZMO_VERTEX_FLOATS = 7 as const;

/** Byte stride of one gizmo line vertex (`GIZMO_VERTEX_FLOATS * 4`). */
export const GIZMO_VERTEX_STRIDE = (GIZMO_VERTEX_FLOATS * 4) as number;
