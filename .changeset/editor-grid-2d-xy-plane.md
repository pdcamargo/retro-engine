---
'@retro-engine/engine': minor
---

feat(engine): XY work-plane option for the editor grid

Per ADR-0077, the editor grid (ADR-0076) can now be drawn on the XY work plane as well as the XZ ground plane, so an orthographic 2D editor view has a grid that faces the camera. `EditorGrid.plane` selects which plane; the same Core3d pass renders either.

The grid shader is generalized rather than duplicated: it emits a world-space quad on the selected plane transformed by `view_proj` (so depth stays correct and meshes occlude the grid in both modes), reusing the existing fwidth-AA line computation. For an orthographic camera it sizes the quad to the visible extent (`1 / projection[i][i]`) and skips the distance fade; for a perspective camera it keeps the camera-distance fade. The config uniform gains a single `plane` flag — no second shader, pass, or pipeline.

**New public surface:**

- `EditorGrid.plane: GridPlane` (`'xz' | 'xy'`, default `'xz'`) — selects the ground plane vs. the XY work plane.
- `GridPlane` — `'xz' | 'xy'` string-literal union.

No behaviour change for existing users: `plane` defaults to `'xz'` and the grid renders exactly as before.
