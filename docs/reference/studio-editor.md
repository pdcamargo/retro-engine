# Studio / Editor — current state

Covers `apps/studio`, `packages/editor-sdk`, `packages/editor-mcp`, `packages/studio-mcp-server`,
`packages/mcp-protocol`, `packages/graph-editor`, `packages/editor-platform`, and
`packages/project` / `packages/create-project`.

**Shape to know up front:** the studio is a Tauri 2.x desktop editor (Dear ImGui via jsimgui, WebGPU).
The genuinely production-shaped areas are the **MCP surface (66 tools)**, the **panel/docking shell**,
**transform gizmos + picking + camera**, the **reflection-driven inspector with undo/redo**,
**hierarchy editing**, **prefab authoring**, the **animation-controller editor**, the **graph-editor
toolkit**, and the **standalone project open/build/index/hot-reload** system. The weak/illusory areas:
material editing (reflection fields only), most asset-browser context actions (stubs), Project Settings
(renders but never saves), play controls (Step is dead), rendered thumbnails (disabled), a band of
drawn-but-dead menu chrome, and **single-select everywhere**. There is **no game export/ship pipeline**.

---

## Shell, panels, layout

- ✅ **Panel/docking shell** (`editor-sdk/src/editor.ts`, ADR-0072/0073) — registry-driven `Editor`
  (`addPanel`/`addMenu`/`setToolbar`/`setStatusBar`), real ImGui dockspace, per-slot default layout,
  layout persistence per-project. 15 panels registered.
- 🟡 **No user-savable named layouts** — the toolbar "Layout" button is a no-op.

## Viewport, gizmos, camera, picking

- ✅ **Viewport** (ADR-0074) — Scene + Game render-to-texture panels (separate editor/game targets);
  game view renders continuously even when not playing.
- ✅ **Camera controller** (ADR-0077) — fly/orbit/pan/dolly, 2D/3D projection swap, **Frame Selected (F)**.
- ✅ **Transform gizmos** (`editor-sdk/src/gizmo/`, ADR-0075/0084) — move/rotate/scale (axis/plane/screen),
  2D+3D handle sets, screen-constant sizing, drag readout, Esc-cancel; edits the world-space proxy from
  `GlobalTransform` and maps back through the parent inverse.
- ✅ **Selection picking** (`scene-picker.ts`) — ray-cast, **AABB granularity** (per-`Mesh3d` bounds, not
  per-triangle); click-empty clears.
- ✅ **Orientation gizmo / view cube** (ADR-0085); **drag-drop into viewport** (prefab/scene/glTF/material)
  with live preview (ADR-0136).
- 🟡 **Single-entity selection only** — `state.selectedEntity: Entity | null`; no rubber-band/multi-select,
  no multi-object gizmo (the gizmo core supports N targets; the studio passes one). Snap-to-grid on drag
  is noted "future".

## Hierarchy, inspector

- ✅ **Hierarchy** (`panels-left.ts`, ADR routed via MCP) — live tree, filter, create/rename (F2)/delete
  (Del)/duplicate (Ctrl+D), drag-to-reparent with cycle prevention, drop-asset-to-instantiate, context
  menus. All edits route through MCP → History + audit. 🟡 single-select.
- ✅ **Inspector** (`panels-inspector.ts`, ADR-0060/0082/0110) — reflection-driven component UI
  (`renderComponentBody` walks each serializable component's schema; per-kind renderers), edits through
  undoable `History`, Add Component via Composer, custom kind renderers (asset-handle picker, morph
  sliders). Asset editing in the same panel; derived (sub-asset) materials read-only with "Extract
  editable copy" (ADR-0135). `AssetEditorRegistry` exists but **none registered** (all fall back to the
  reflection walk).
  - 🟡 **Gaps** — no per-field reset, no multi-object inspector, no component reorder, no copy/paste
    component values; remove-component is via the composer/MCP, not a first-class inspector button.

## Asset browser

- 🟡 **Browse is real; most actions are stubs** (`apps/studio/src/assets/`). Real: folder tree, breadcrumb,
  search, type filter, zoom, tile grid, derived sub-asset drawers, live list from the manifest, thumbnails.
  Real actions: open/activate, inline rename (file + `.meta`), delete (file + sidecar + unload), **create
  (only AnimationController)**, drag entity in → author prefab.
  - 🔩 **Stub context actions** (`console.info` via `stubRun`): Duplicate, Reimport, Show in Explorer,
    Sprite Editor, Create Material, Set as Skybox, Import Settings, Extract Animations, Create Prefab
    (menu variant), Edit Shader, Duplicate as Variant, audio Play.
  - 🔩 **Rendered thumbnails disabled** (`RENDERED_THUMBNAILS = false`); CPU flat-shade shape thumbnails
    only (ADR-0101/0103).
  - ❌ **Import-from-OS UI** — loose files get `.meta` sidecars via the watcher; there is no "Import…"
    dialog / drag-from-desktop.

## Play, history, prefabs, animator, graph

- 🟡 **Play/pause/stop** (ADR-0087) — `SimState` (Edit/Play/Paused); toolbar Play↔Stop and Pause work;
  user systems gated behind Play; MCP `studio.play/pause/stop` work. ✅ **World snapshot/restore on
  play** now wired (`installPlayModeSnapshot`) + MCP-verified: Stop reverts authored edits with no
  glTF-rig duplication (composition-aware capture); selection clears on restore. 🔩 **Step is dead**
  everywhere; true selection survival + inspector-during-play remain (roadmap/play-mode.md).
- ✅ **Undo/redo history** (`editor-sdk/src/edit/history.ts`, ADR-0082/0083) — capacity 200; setField/
  add/remove component/addBundle/custom/batch; history panel timeline + click-to-jump; Ctrl+Z/Y/Shift+Z;
  dirty tracking; MCP `history.*`.
- ✅ **Prefab authoring** (ADR-0067/0108/0136) — drag entity → `.prefab`; `asset.instantiate` linked
  instances; derived-entity overrides (ADR-0113); the Composer modal authors entities/components/bundles
  (`.rebundle`).
- ✅ **Animator** (`apps/studio/src/animator/`, ADR-0119/0140/0141/0142) — edits `AnimationController`
  (`.ranimctrl`): layers/parameters sidebar, state-machine canvas via the graph-editor toolkit, nested
  blend-tree descent, add/rename/delete layer/param/state/transition, YAML round-trip. 🟡 **no clip/
  keyframe/dope-sheet/curve editor** (controller graph only).
- ✅ **Graph-editor toolkit** (`packages/graph-editor`, ADR-0137/0138/0139/0143) — document/view/render/
  ops/serialize, typed pins, bezier+transition edges, reroutes, groups/subgraphs, extensible renderers,
  History document-commands. Consumers: the Animator (real) and a **demo panel** (`panels-graph-demo.ts`).
  🔩 **Material/visual-scripting/VFX use is absent** (demo nodes only). MCP `graph.*` operate on the demo host.
- 🔩 **Material editor** — materials are edited **only** through the reflection inspector; no node/shader
  graph is wired to materials (see roadmap: visual shader graph).

## MCP surface (the strongest area)

- ✅ **66 tools** (ADR-0109) — studio ⇄ localhost WebSocket relay ⇄ stdio MCP server; tools sourced live
  from the studio catalog so new commands surface automatically. All mutating commands route through the
  same History + audit path as the UI. Groups: studio (7, incl. gated `studio.eval`), selection (4),
  hierarchy (2), entity (7), component (4), asset (6), prefab/material (3), scene (3), history (4),
  renderer (2), logs (1), panels (4), composer (3), screenshot (3), graph (11), relay-static (2).
- 🟡 **Planned expansion** (roadmap/studio-mcp.md) — `assets.import`, `animController.*`,
  `studio.run_tests`, per-connection token hardening.

## Standalone project system

- ✅ **Open/build/index/run a user project** (ADR-0090–0097/0099/0102) — open = App-rebuild + reload;
  descriptor `project.retroengine`; user-code build via Bun (engine externalized to the studio's live
  instances) — native path via Tauri `project_build` sidecar, browser path via dev server; native FS IO
  (root-scoped Rust commands); manifest scan + `.meta` minting; startup scene load + Save Scene;
  file watching + **hot code reload** (native); editor-extensions second build artifact; project
  scaffolding CLI (`packages/create-project`).
- ❌ **No game ship/export** — the pipeline builds user code to run **inside the studio**; there is no
  packaged binary / web build. (This is the export-system roadmap work.)

## Console, stats, settings; dead chrome

- ✅ **Console** (read-only), **Systems** panel (per-system enable toggles + ms), **Profiler** panel,
  status bar; `renderer.stats`/`renderer.capabilities` MCP.
- 🟡 **Preferences** — dock layout / composer favorites / asset-browser zoom persist. **Project Settings
  dialog renders but Save just closes it** (values never persisted/applied — effectively a stub,
  backlog/editor-human-readable-settings.md). No global application Preferences window (theme exists in
  code, no switcher).
- 🔩 **Drawn-but-dead chrome** (`chrome.ts`) — File ▸ New Scene / Open Scene… / Save As…; Edit ▸ Cut/Copy/
  Paste; Run ▸ Play/Pause/Step (toolbar Play/Pause work; Step doesn't); Help ▸ Documentation/About;
  toolbar Layout + Step; hardcoded status strings.

---

## ❌ Absent vs a mature editor (Unity/Godot) — all in the roadmap

Multi-entity selection & multi-object editing · clipboard (cut/copy/paste entities) · multiple/New/Open/
Save-As scenes (backlog/scene-file-actions.md) · material/shader node editor & visual scripting ·
animation clip/dope-sheet/curve editor · Timeline/cutscene sequencer · sprite/atlas/tilemap/particle
editors · asset import UI · in-engine rendered thumbnails · terrain/navmesh/collider/audio-mixer/UI-canvas
editors · **build/package/ship a standalone game** · VCS integration · functional Preferences · per-field
reset / component reorder.
