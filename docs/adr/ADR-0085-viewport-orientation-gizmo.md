# ADR-0085: Viewport orientation gizmo

- **Status:** Accepted
- **Date:** 2026-06-18

## Context

The Scene viewport had a fly/orbit/pan camera ([ADR-0084] wired selection + picking on top of it) but no orientation aid — nothing showing which way the camera faces, and no quick way to drop to an axis-aligned view. Every other editor (Blender, Unity, Godot) puts a small camera-orientation widget in a viewport corner for exactly this. Our top-right corner was occupied by two info chips (FPS + entity count) that duplicated the status bar and earned little.

The reference the work was modelled on is the [three-viewport-gizmo] library (sphere type): the colored X/Y/Z balls are always drawn and reflect the camera orientation; a disc fades in behind them on hover; **dragging the body orbits** the camera; **clicking a ball aligns** the view to that axis; the alignment animates (configurable speed) or snaps. The studio renders its viewport through Dear ImGui draw lists, and the editor camera (`SceneCameraController`) already tracks orbit state as `yaw`/`pitch`/`pivot` — a close match to the library's spherical model.

Two studio-specific questions had to be answered. The viewport has a `'2d'` mode (orthographic top-down, rotation locked) distinct from `'3d'` (perspective). And axis-aligned "front/top/side" views are classically orthographic, which our architecture ties specifically to that `'2d'` mode.

## Decision

Add a configurable, reusable orientation gizmo to `editor-sdk`, draw it as a 2D ImGui overlay, and wire it to the editor camera in the studio. Remove the FPS + entity-count chips to free the corner.

- **2D draw overlay, not a 3D render target.** The widget projects the six world axis unit vectors through the camera's view rotation into the corner and draws balls/lines/labels via the existing `Draw` facade. For a flat sphere-type gizmo this is visually identical to rendering a separate 3D scene, with trivial hit-testing and no extra framebuffer.
- **Reusable, fully-configurable widget.** `ViewportGizmo` (in `editor-sdk`) is pure and host-agnostic: `update(input)` draws itself and returns intents (orbit deltas, axis picks); it knows nothing about the App or camera. A single `ViewportGizmoOptions` object drives size, placement, colors, opacity, labels, line/ball sizing, animation, and behavior flags — mutate it to restyle, no code change. Unset (`null`) colors resolve from the active theme palette, so axis colors match the inspector's X/Y/Z fields (`axisColor`) rather than hardcoded values.
- **Drag orbits, click aligns.** A press that moves past a pixel threshold becomes a drag (orbit deltas in radians, scaled by widget size); a press that releases in place is a click on the focused ball (an axis pick). The host suppresses viewport navigation, transform handles, and picking while the gizmo is hovered or dragging.
- **Keep the current projection on align.** Clicking an axis reorients the orbit camera to look down that axis at the current pivot, keeping perspective. Introducing orthographic per-axis views would mean decoupling "orthographic" from the `'2d'` view-mode — out of scope.
- **2D promotes to 3D on interaction.** The gizmo is always visible. Dragging it, or clicking any axis, while in `'2d'` switches the view to `'3d'` first, then orbits/aligns — gated by the `exit2dOnInteract` option (default on). The gizmo is fundamentally a 3D-orientation tool, so any rotation gesture implies leaving the locked top-down view; this matches the user's expectation and Blender/Unity's 3D-centric model (Godot hides its 3D gizmo in 2D instead, which a unified-viewport editor doesn't want).
- **Controller stays the single transform writer.** `SceneCameraController.requestOrbit` / `snapToAxis` queue intents; they are applied in the existing `tick` (an `update` system), which also eases an animated align toward its target `yaw`/`pitch` along the shortest angular path using the unpaused `Time.real` delta. Manual navigation cancels an in-progress align.

## Consequences

- The orientation widget and the existing in-world `TransformGizmo` are independent: one is a screen-fixed navigation aid drawn in 2D, the other edits a selected entity's transform in the 3D world. They share only the `editor-sdk/gizmo` folder and the pointer-suppression handshake.
- Axis-align animation reuses the camera's `yaw`/`pitch` model, so a true top/bottom view (looking straight down/up) is clamped to ±89° to avoid the `lookAt` up-vector degeneracy the controller already guards against. A pixel-exact straight-down view remains the job of `'2d'` mode.
- The FPS + entity-count chips are gone from the Scene view; that information still lives in the status bar / profiler. The left-side chips (projection, resolution, PLAYING) stay.
- Configuration lives in `StudioState.viewportGizmo` as editor state, not an engine component — no reflection schema (it never serializes into a scene). The widget reads that object live, so a future Settings panel can restyle it at runtime with no rebuild.

## Implementation

- `packages/editor-sdk/src/gizmo/viewport-gizmo.ts` — `ViewportGizmo` (layout, draw, hit-test, drag/click).
- `packages/editor-sdk/src/gizmo/viewport-gizmo-types.ts` — `ViewportGizmoOptions`, `defaultViewportGizmoOptions`, `ViewportGizmoInput`/`ViewportGizmoOutput`, `AxisPick`, `ViewportGizmoPlacement`.
- `apps/studio/src/viewport-gizmo-wiring.ts` — `SceneOrientationGizmo` (reads the editor camera, forwards intents).
- `apps/studio/src/editor-camera.ts` — `SceneCameraController.requestOrbit`, `snapToAxis`, the snap-tween in `tick`.
- `apps/studio/src/state.ts` — `StudioState.viewportGizmo`.
- `apps/studio/src/panels-viewport.ts`, `apps/studio/src/main.ts` — draw/capture in the Scene panel, suppress nav/picking while active; FPS + entity chips removed.

[ADR-0084]: ADR-0084-viewport-selection-and-gizmo-binding.md
[three-viewport-gizmo]: https://github.com/Fennec-hub/three-viewport-gizmo
