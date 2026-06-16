# Gizmo selection ↔ ECS bridge

- **Created:** 2026-06-14

## Context

The transform gizmos (ADR-0075) currently bind to entities through a studio-local `EditorGizmo` marker attached per demo primitive, with one `TransformGizmo` controller per marked entity. This was deliberate: viewport picking was out of scope for that pass, and the studio's hierarchy/inspector operate on a mock scene-data model (string ids) that is disconnected from the real ECS entities (`scene-data.ts` vs the `cmd.spawn` entities in `scene-bootstrap.ts`). So there was no path from "what's selected in the hierarchy" to "a live ECS `Transform`".

A real editor drives a **single** gizmo from the active tool + current selection, not one fixed gizmo per object. That needs the selection state to resolve to live ECS entities.

**Update (2026-06-16, ADR-0079):** the first scope bullet below is delivered — the hierarchy is backed by the live world and `state.selectedEntity` now resolves to an `Entity`. Remaining: viewport ray-picking and driving one `TransformGizmo` from `(tool, selection)`, retiring the `EditorGizmo` demo markers.

## Why deferred

Depends on two pieces that are their own work: viewport ray-picking (panel cursor → world ray → entity hit-test, the `ViewportTarget.localMouse` plumbing already anticipates this) and a hierarchy/selection model backed by real ECS entities rather than the mock `scene-data` tree.

## Scope when picked up

- Replace the mock hierarchy model with one backed by live ECS entities (likely keyed by a stable `Name` or entity id), so `state.selected` resolves to an `Entity`.
- Add viewport ray-picking to set selection from clicks in the Scene view.
- Drive a single `TransformGizmo` from `(activeTool → GizmoMode)` over the selected entities' `Transform`s (the controller already supports a multi-target selection set about a shared pivot).
- Retire the per-entity `EditorGizmo` demo markers and `SceneGizmos`' one-controller-per-entity loop.

The `TransformGizmo` controller, the gizmo math, and the engine `Gizmos` pass are unchanged — this only changes how targets and mode are chosen each frame.
