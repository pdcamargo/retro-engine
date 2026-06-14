# ADR-0076: Editor ground-plane grid

- **Status:** Accepted
- **Date:** 2026-06-14

## Context

ADR-0075 gave the studio a world-space `Gizmos` debug-draw API and an editor-only render layer (`EDITOR_GIZMO_LAYER`, bit 31) gating editor visuals out of the Game view. The Scene viewport still lacked a ground reference grid — the spatial anchor an editor needs to judge scale, placement, and orientation, and the future home for snap-to-grid.

The grid must be **configurable** (tile size, subdivisions, colors, overall extent, plane height) so a settings dropdown can drive it, and it must **look good at steep / grazing camera angles** — the case where a naive grid is at its worst.

The obvious route, given ADR-0075, is to emit the grid as line segments through the `Gizmos` buffer (`Gizmos.grid` already exists). But the gizmo pass draws 1px hardware `line-list` segments with no per-fragment width or coverage control. At grazing angles, distant grid lines compress below a pixel and shimmer/moiré badly; per-vertex distance fade does not fix the aliasing because the lines themselves are the problem. This is a known weak spot of line-based grids and the reason editors (Blender, Godot) draw their grids with a shader instead.

## Decision

Add an engine-level **analytic ground-plane grid** rendered by a dedicated pass, mirroring the gizmo pass architecture and reusing its editor-layer gating. Opt-in via `GridPlugin` (not auto-installed), configured by an `EditorGrid` resource the editor mutates.

- **Analytic, not line geometry.** The grid lines are computed per-fragment from world-space coordinates and anti-aliased against the screen-space derivative of that position (`fwidth`). A line that compresses to sub-pixel width near the horizon fades out smoothly instead of aliasing — this is what makes it correct at steep angles. Minor lines at `cellSize`, major lines every `majorEvery` cells, and colored world X/Z axis lines compose in one fragment shader.
- **Camera-centered ground quad, not a fullscreen ray-cast.** The vertex stage emits a 6-vertex quad on the plane (`y = planeHeight`), centered on the camera's horizontal position (read from the shared `@group(0)` view uniform) and sized to the grid extent. Because it is a real plane transformed by `view_proj`, depth comes from rasterization and is consistent with the scene depth buffer — scene geometry occludes the grid with no manual depth reconstruction or `frag_depth` write, and no inverse-matrix math. The grid pattern is anchored to absolute world coordinates, so lines stay put as the camera moves; the quad merely guarantees the visible area is covered.
- **Smooth radial distance fade** (`fadeStart`→`fadeEnd`) dissolves the grid toward the horizon instead of ending on a hard edge. `fadeEnd` doubles as the quad extent, so there is never geometry beyond where the grid has faded out.
- **Depth-tested, never depth-writing** (`depthCompare: 'less-equal'`, `depthWriteEnabled: false`), matching the gizmo policy: the grid respects scene depth but does not block later passes. It draws into the camera's final (post-tonemap) LDR target so configured colors are exact, after the transparent + post passes and **before** the gizmo pass, so transform handles sit on top.
- **Editor-only via the existing layer gate.** The pass runs only for views whose `renderLayers` include `EDITOR_GIZMO_LAYER`; the editor camera opts in, the game camera does not. No new separation mechanism.
- **The config uniform is view-independent.** It carries only `EditorGrid` values (colors, cell size, major spacing, plane height, fade range); per-camera position and matrices come from `@group(0)`. So a single uniform buffer, uploaded once per frame in `RenderSet.Prepare`, serves every editor camera correctly — no per-view buffer juggling.
- **Snap config travels with the grid.** `EditorGrid` also carries `snapEnabled` / `snapStep` so one object is the single source of truth for the settings dropdown and a future snap-to-grid tool. The renderer ignores these fields; the studio mirrors its toolbar snap toggle into them.

WebGL2 reachability: `fwidth` (standard derivatives) and the unprojection-free quad approach are plain GLSL ES 3.0 — the grid needs **no optional `RendererCapabilities` flag**.

## Consequences

- The grid is crisp at any angle and fades cleanly to the horizon, the explicit quality bar for this work. The cost is one extra graph edge and a single 6-vertex draw per editor camera per frame, plus one small uniform upload — fixed cost, independent of scene content, so no benchmark is warranted (CLAUDE.md §11).
- All grid configuration is live: mutating `EditorGrid` fields takes effect next frame, which is exactly the surface a settings dropdown drives. The dropdown UI itself is deferred — this slice ships the plumbing.
- Snap-to-grid is configured but not yet enforced: no tool reads `snapEnabled` / `snapStep` yet. Wiring it into the transform gizmo's translation deltas is separate work.
- The grid is a 3D ground-plane aid only — no Core2d pass. A 2D editor grid, if wanted, is a separate decision.
- `GridPlugin` is opt-in, so shipped games pay nothing. Editor hosts add it explicitly. The grid being engine-resident (not editor-sdk) follows the gizmo precedent: the render graph and view bind group are engine-owned, and the editor layer constants already live in `packages/engine`.

## Implementation

- `packages/engine/src/grid/grid-config.ts` — `EditorGrid` (config resource: `enabled`, `planeHeight`, `cellSize`, `majorEvery`, `minorColor`, `majorColor`, `xAxisColor`, `zAxisColor`, `fadeStart`, `fadeEnd`, `snapEnabled`, `snapStep`).
- `packages/engine/src/grid/grid.wgsl.ts` — `GRID_WGSL` (`retro_engine::grid`): camera-centered quad VS + analytic minor/major/axis fragment shader with derivative AA and distance fade.
- `packages/engine/src/grid/grid-render-state.ts` — `GridRenderState` (uniform buffer, `@group(1)` bind group, format-specialized pipelines), `GridPipelineKey`.
- `packages/engine/src/grid/grid-pass-node.ts` — `makeGridPassNode`, `GridPass3dLabel`.
- `packages/engine/src/grid/grid-plugin.ts` — `GridPlugin` (registers shader + resources + prepare system; inserts the pass into Core3d after transparent/post, before the gizmo pass).
- `packages/engine/src/index.ts` — re-exports `EditorGrid`, `GridRenderState`, `GridPipelineKey`, `GridPass3dLabel`, `GridPlugin`.
- `apps/studio/src/scene-bootstrap.ts` — installs `GridPlugin`.
- `apps/studio/src/main.ts` — mirrors the toolbar snap toggle into `EditorGrid`.
- `apps/studio/src/state.ts` — `StudioState.snapStep`.
