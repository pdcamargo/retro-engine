---
'@retro-engine/math': minor
'@retro-engine/engine': minor
'@retro-engine/editor-sdk': minor
---

feat: gizmos + debug-draw system and editor transform gizmos (ADR-0075)

An engine-level, immediate-mode, world-space `Gizmos` debug-draw API rendered through a dedicated line pass, plus editor transform gizmos built on top of it. The gizmo pass renders into both `Core2d` and `Core3d`, after the transparent/post passes and before tonemapping, and gates each draw by the camera's render layers — a reserved `EDITOR_GIZMO_LAYER` keeps editor-only visuals out of the game view. This is the documented, scalable pattern for separating editor visuals from game visuals; the debug-draw API itself is exposable to user game code.

**`@retro-engine/math`** — new geometry primitives for picking and gizmo math, projection-agnostic (correct under perspective and orthographic):

- `Ray` + `Ray.fromScreen` (NDC → world ray unprojection, WebGPU `[0,1]` depth).
- `rayPlaneIntersect`, `rayClosestPointToRay`, `signedAngleOnPlane`.
- `screenSpaceScale` — world length that subtends a target pixel size, for constant-on-screen gizmo sizing.

**`@retro-engine/engine`** — immediate-mode gizmo rendering:

- `Gizmos` resource with `line` / `lineGradient` / `ray` / `circle` / `arc` / `sphere` / `cuboid` / `arrow` / `axes` / `grid`, each tagged with a render-layer mask and depth-test flag, cleared per frame.
- `GizmoPlugin` (auto-added by `CorePlugin`), the `Core2d`/`Core3d` line pass, and `EDITOR_GIZMO_LAYER` / `EDITOR_GIZMO_MASK` for editor-only visuals.

**`@retro-engine/editor-sdk`** — `TransformGizmo`: interactive Move / Rotate / Scale / All handles in 2D and 3D, editing one or more targets about their shared centroid, with constant on-screen sizing, a live drag readout (delta / angle / factor), and Escape-to-cancel.
