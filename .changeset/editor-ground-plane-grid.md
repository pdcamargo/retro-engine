---
'@retro-engine/engine': minor
---

feat(engine): editor ground-plane grid (`GridPlugin`, `EditorGrid`)

Per ADR-0076, adds an analytic ground-plane reference grid rendered by a dedicated, opt-in pass that mirrors the gizmo pass and reuses its editor-only render layer (`EDITOR_GIZMO_LAYER`), so the grid shows in editor viewports and never in the Game view.

The grid lines are computed per-fragment from world coordinates and anti-aliased against the screen-space derivative (`fwidth`), with a smooth radial distance fade — so it stays crisp and dissolves cleanly toward the horizon at steep / grazing angles, where a line-based grid would shimmer and moiré. Geometry is a single camera-centered quad on the plane, transformed by `view_proj`, so depth comes from rasterization and scene geometry occludes it correctly (depth-tested, never depth-writing) with no inverse-matrix or `frag_depth` work. No new HAL, no new capability flag — `fwidth` is GLSL ES 3.0, so the grid is WebGL2-reachable.

**New public surface:**

- `EditorGrid` — config resource (live-mutable): `enabled`, `planeHeight`, `cellSize`, `majorEvery`, `minorColor` / `majorColor` / `xAxisColor` / `zAxisColor`, `fadeStart`, `fadeEnd`, and `snapEnabled` / `snapStep` (carried for snap tooling; the renderer ignores them).
- `GridPlugin` — opt-in plugin (not auto-installed by `CorePlugin`); registers the `retro_engine::grid` shader, inserts the config + GPU resources and the per-frame uniform upload, and wires the pass into Core3d after the transparent + post passes and before the gizmo pass.
- `GridRenderState` (`GridPipelineKey`) — render-world GPU state: config uniform buffer, `@group(1)` bind group, format-specialized pipelines.
- `GridPass3dLabel` — render-graph label for the grid pass node.

The config uniform is view-independent (per-camera data comes from the shared view bind group), so one buffer uploaded once per frame serves every editor camera. Cost is a single fixed 6-vertex draw per editor camera; nothing scales with scene content.
