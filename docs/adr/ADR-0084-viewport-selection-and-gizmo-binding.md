# ADR-0084: Viewport selection and gizmo binding

- **Status:** Accepted
- **Date:** 2026-06-18

## Context

ADR-0075 shipped a working `Gizmos` debug-draw layer and a `TransformGizmo` controller, but explicitly deferred the selection↔ECS bridge: "A real editor would drive a single gizmo from the active tool + selection once a selection↔ECS bridge exists." As a stopgap it bound a fixed mode to each demo primitive with a studio-local `EditorGizmo` marker component, and viewport picking was out of scope.

That bridge is now needed. The studio already tracks a selected entity (`StudioState.selectedEntity`, set from the hierarchy) and an active transform tool (`StudioState.tool`), and the toolbar/keyboard already switch the tool — but nothing connected those to the gizmo, so no gizmo ever appeared, and the only way to select an entity was the hierarchy. The editor camera exposes a computed view-projection, mesh entities carry a `Mesh3d` + `GlobalTransform`, and `Mesh` can compute a local-space `Aabb` — so the pieces for click-to-select existed but were unconnected.

## Decision

Make selection the single source of truth that drives one transform gizmo, and add viewport click-picking to set that selection.

- **Selection-driven gizmo.** `SceneGizmos` binds to `StudioState.selectedEntity` and reads its mode from `StudioState.tool` (`move`/`rotate`/`scale`/`all` map straight to `GizmoMode`; `select` shows no gizmo), gated by the `StudioState.gizmos` visibility toggle. The `EditorGizmo` marker component and its multi-entity query are removed. A `select`/`all` toolbar entry plus a `T` shortcut round out the tool set. Hierarchy selection drives the gizmo for free, since it already writes `selectedEntity`.
- **World-space binding.** The `TransformGizmo` operates in world space, so `SceneGizmos` edits a proxy TRS decomposed from the selection's `GlobalTransform` (handles sit at the world pose; drags happen along world axes) and maps the edited world pose back to the entity's local `Transform` via the parent's inverse — `local_new = (local_old · world_old⁻¹) · world_new`, derived from the matrices already in hand, so it needs no `Parent` lookup and holds at any nesting depth. Editing the local `Transform` directly would misplace the gizmo for any entity under a transformed parent. This promotes the engine's `composeTransformInto` to public and adds `decomposeTransformInto`.
- **CPU ray-vs-AABB picking.** A new `ScenePicker` casts a ray from the editor camera through the cursor (`Ray.fromScreen` + inverse view-projection) and selects the nearest entity whose **world-space mesh AABB** the ray enters, via a new `rayAabbIntersect` math primitive. Picking is at AABB granularity — not per-triangle — and selects the entity carrying the `Mesh3d` directly. A click on empty space clears the selection.
- **Transform lock.** Picking runs in a `postUpdate` system ordered **after** the gizmo tick and is suppressed whenever the gizmo is engaged (`SceneGizmos.isActive()` — hovering a handle or mid-drag). So the click that begins a drag, and every click during one, never re-selects another entity. Clicks that drive camera navigation (Alt/Space held) are also ignored.

## Consequences

- One gizmo at a time, on the current selection, in the active tool's mode — the model ADR-0075 anticipated. The per-primitive demo binding is gone.
- Picking is O(entities) per click against conservative AABBs: cheap (clicks are rare, not per-frame) but coarse — it can hit the bounding box of a concave or sparse mesh where no triangle is. Per-triangle refinement and a GPU entity-id buffer (pixel-exact, constant-cost, handles overlapping/instanced geometry) are deliberately deferred; the AABB path is enough for the current scenes and adds no GPU readback or render-target plumbing.
- Scoped to `Mesh3d` entities. It works under both perspective and orthographic cameras (`Ray.fromScreen` handles both), but sprite-/2D-only pickables and marquee/multi-select are not covered yet.
- One frame of latency on a pick (the click is captured in the UI pass and resolved in the next `postUpdate`), which is imperceptible and matches how the gizmo and camera controller already split their work.

## Implementation

- `packages/math/src/ray.ts` — `rayAabbIntersect`.
- `packages/engine/src/transform.ts` — `composeTransformInto` (now public), `decomposeTransformInto`.
- `apps/studio/src/gizmo-wiring.ts` — `SceneGizmos` (selection-driven; `isActive`); `EditorGizmo` removed.
- `apps/studio/src/scene-picker.ts` — `ScenePicker`.
- `apps/studio/src/editor-view.ts` — `findEditorCamera` (shared camera lookup).
- `apps/studio/src/state.ts` — `TransformTool` gains `all`.
- `apps/studio/src/chrome.ts`, `apps/studio/src/shortcuts.ts` — `all` tool button + `T` shortcut.
- `apps/studio/src/main.ts`, `apps/studio/src/panels-viewport.ts` — construct/wire the picker; pick after the gizmo tick.
