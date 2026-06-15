# ADR-0077: Editor camera controller and 2D/3D view toggle

- **Status:** Accepted
- **Date:** 2026-06-14

## Context

The Scene viewport (ADR-0074) rendered through a single perspective editor camera spawned once with a fixed `lookFrom(...)` and never moved — there was no editor input/navigation layer at all, and no keyboard-shortcut scheme. To inspect a scene you could not orbit, pan, fly, or zoom, and there was no way to author 2D content with an orthographic view.

The engine separates 2D and 3D rendering: `Camera2d` dispatches the depth-less `Core2d` sub-graph (painter's-order sprites), `Camera3d` dispatches `Core3d` (meshes + depth). ADR-0076 added an analytic editor grid, but only as an XZ ground plane in `Core3d` — invisible to an orthographic front view — and explicitly left "a 2D editor grid … a separate decision."

This decision adds the missing editor-camera navigation foundation, a viewport mode toggle between perspective (3D) and orthographic (2D) viewing, a centralized shortcut scheme, and the XY-plane grid the 2D view needs.

The mode toggle could mean two different things: a separate `Camera2d`/`Core2d` authoring camera (Godot's separate-workspaces model), or an orthographic view of the *same* 3D scene (Unity's Scene-view "2D" button). The first hides all 3D meshes when toggled — surprising for a single scene — and Godot reaches it only with node-type-driven workspaces and selection-driven auto-switching this studio doesn't have. Bevy ships no editor, so it offers no toggle precedent (its runtime `Camera2d`/`Camera3d` split is what this engine already mirrors). Unity's behavior — orthographic projection on the same scene, locked to a front view — is the least surprising and what the meshes-still-visible expectation wants.

## Decision

- **Follow Unity: 2D mode is an orthographic view of the same 3D scene.** The editor camera stays a `Core3d` camera (depth + prepasses + TAA) in both modes; toggling swaps **only its projection component** — `PerspectiveProjection` ↔ `OrthographicProjection` — and locks it to a front (XY) view. The 3D meshes keep rendering; orthographic just removes perspective and the camera's free rotation.
- **One persistent editor camera entity, projection swapped in place.** The viewport texture, gizmo wiring, and resize-redirect locate the camera by its render-target texture, not its entity id. The toggle removes the old projection and inserts the new one via `Commands`; the camera, its Core3d sub-graph, depth, and prepasses are untouched. The chosen mode persists in `StudioState.viewMode`; a reconcile system applies changes before the controller writes the transform that frame.
- **A studio-local `SceneCameraController` owns navigation**, holding per-mode state. It reads ImGui pointer/wheel/keyboard input in the Scene panel body (the only place ImGui input is live) and applies it from an `update` system before the camera matrices recompute, mirroring the gizmo capture/tick split. 3D: right-mouse look with WASD/QE fly (Shift faster), middle-mouse pan, wheel dolly, Alt+left-mouse orbit. 2D: middle-mouse or Space+left-mouse pan, wheel zooms the orthographic extent; no rotation. Navigation acts only while the viewport is hovered.
- **A centralized shortcut scheme** (`shortcuts.ts`) replaces scattered key checks: `2`/`3` toggle mode, `F` frames, `Q/W/E/R` pick the transform tool. Tool/mode keys are suppressed while a navigation drag is active, so the fly keys never double as tool keys.
- **The single Core3d grid pass serves both planes**, extending ADR-0076's grid rather than adding a second pass. `EditorGrid.plane` (`'xz'` | `'xy'`) selects the plane; the toggle drives it in step with the projection. The shader draws a real world-space quad on the selected plane transformed by `view_proj` (so depth is correct and meshes occlude the grid in both modes), detects orthographic projection from the projection matrix to size the quad to the visible extent (`1 / projection[i][i]`) and drop the distance fade, and reuses the same analytic fwidth-AA line computation. The config uniform gains one `plane` flag; no second shader, pass, or pipeline.

## Consequences

- The Scene viewport is fully navigable in both modes, the 3D scene stays visible in 2D (the explicit fix), and the grid switches to the XY work plane the front view needs.
- The 2D camera uses an orthographic slab spanning both sides of the work plane (`near = -1000`, `far = 1000`, like `Camera2d`), so content in front of and behind `z = 0` both render. Exact depth ordering between overlapping meshes in the flat front view is coarse, which is acceptable for an editing aid.
- Keeping one Core3d camera means 2D mode pays for depth + prepasses + TAA it does not strictly need. That is the cost of not respawning; the toggle stays a single component swap with no sub-graph churn, and the anti-aliased path is desirable anyway.
- Frame Selected currently frames the scene origin: the studio's selection (`StudioState.selected`) indexes the mock hierarchy, not live ECS entities. When hierarchy selection is wired to ECS, `frame()` targets the selection's bounds with no controller change.
- The grid keeps its fixed per-camera cost (one 6-vertex draw + one small uniform upload), so no benchmark is warranted (CLAUDE.md §11). The plane generalization is one extra `plane` slot in the existing uniform and a branch in the shader — no new GPU resources.
- The controller, toggle, and shortcuts are studio-local (`apps/studio`); only the grid generalization ships in `@retro-engine/engine`. No new serialized component is introduced — `EditorGrid` is a resource and `EditorCameraTag` is studio-local — so CLAUDE.md §13 is unaffected.

## Implementation

- `packages/engine/src/grid/grid-config.ts` — `EditorGrid.plane`, `GridPlane` type.
- `packages/engine/src/grid/grid.wgsl.ts` — `GRID_WGSL` generalized: world-space quad on the XZ or XY plane (selected by the `plane` uniform), orthographic detection sizing the quad to the view extent and skipping the distance fade.
- `packages/engine/src/grid/grid-render-state.ts` — uploads the `plane` flag into the config uniform; single shader module + pipeline.
- `packages/engine/src/grid/grid-pass-node.ts` — `makeGridPassNode`, `GridPass3dLabel` (editor-layer gated; draws whichever plane the uniform selects).
- `packages/engine/src/grid/grid-plugin.ts` — registers `retro_engine::grid`; inserts the grid pass into `Core3d` after transparent/post, before the gizmo pass.
- `packages/engine/src/index.ts` — re-exports `GridPlane`.
- `apps/studio/src/editor-camera.ts` — `SceneCameraController`, `spawnEditorCamera`, `EditorCameraTag`, `lookFrom`, `defaultEditorTransform`, `ViewMode`.
- `apps/studio/src/shortcuts.ts` — `EDITOR_SHORTCUTS`, `handleShortcuts`.
- `apps/studio/src/state.ts` — `StudioState.viewMode`.
- `apps/studio/src/panels-viewport.ts` — Scene panel drives the controller capture, shortcuts, and mode chip.
- `apps/studio/src/chrome.ts` — toolbar 2D/3D toggle.
- `apps/studio/src/scene-bootstrap.ts` — spawns the initial editor camera via `spawnEditorCamera`.
- `apps/studio/src/main.ts` — constructs `SceneCameraController`; `tick` + mode-reconcile systems.
