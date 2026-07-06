# Master Roadmap

- **Created:** 2026-07-05
- **Status:** Living (the single prioritized checklist across the whole engine; never "done")

The one place that answers *"what do we build next, and in what order?"* across **engine, renderer,
editor, and platform**. It is an **overlay/index**: where a work item already has a `backlog/` or
`roadmap/` file, this links to it rather than restating it; new gaps are first-class here until they
get their own file.

For *what already exists*, see [`../reference/`](../reference/README.md) (the "second brain"). For
*why* something was decided, grep [`../adr/`](../adr).

---

## How to use this (with `/loop`)

1. **Work top-down by priority.** Finish **P0** before **P1**, **P1** before **P2**. Within a tier,
   order is a suggestion — pick the item whose dependencies are met.
2. **One item at a time.** Each item is a checkbox. When you start it, flip it to in-progress in your
   working notes and (per CLAUDE.md §8) create `../backlog/<slug>.md` from the template if it doesn't
   already have a home; link it back here.
3. **Definition of done is the item's AC.** P0 items carry acceptance criteria inline. P1/P2 items
   carry a scope line now; fill in AC when the item is promoted.
4. **"Done" needs the user's explicit say-so** (CLAUDE.md §3). Then check the box here, flip the
   `../reference/` status tag in the same change, and delete the backlog/bug file.
5. **Keep feeding it.** New ideas append to the right tier/category. This file is meant to grow.

## Priority legend

Reasons rest on **impact / dependency / cost**, never genre (CLAUDE.md §12 — "retro" is an aesthetic,
not a capability ceiling).

- **P0 — Critical**: blocks shipping a complete game, or a stability bug that freezes the engine.
- **P1 — Important**: real depth, quality, platform reach, or authoring workflow — high value, not
  blocking a first game.
- **P2 — Nice-to-have**: fidelity/polish/advanced capability; deferred for sequencing/cost or because
  it depends on P0/P1 infrastructure.

## Status legend (mirrors `../reference/`)

`✅ done · 🟡 partial · 🔩 stub · ❌ absent` — the current state of the thing this item builds toward.

## North star

The renderer and ECS are deep, but **you cannot ship a complete game yet**: input now exists
(`@retro-engine/input` ✅), but there is still no audio, engine text, in-game UI, physics, or game
export. **P0 is exactly that shippable-game foundation.**

---

# P0 — Critical

## Engine

- [x] **Input system** — ✅ `@retro-engine/input` (ADR-0144/0145/0146). **Phases 1–4 shipped**
      (keyboard + mouse + action map + gamepad + touch): `ButtonInput<T>` + `Axis<T>`, `KeyboardInput`/
      `MouseButtonInput`/`MouseMotion`/`MouseScroll`/`CursorPosition`, `InputBackend` HAL
      (`DomInputBackend` + headless), component-based `ActionMap` (reflection-registered) + derived
      `ActionState`, poll-based `Gamepads` (`GamepadSource` + standard-mapping + dead zones), `Touches`
      resource, playground `?mode=input` sample.
      _AC:_ pressed / just-pressed / just-released ✅; mouse buttons/motion/wheel/position ✅;
      gamepad ✅; touch ✅; action-map + reflection ✅; headless-safe ✅; a sample moves an entity ✅.
      Optional Phase 5 (studio binding editor) + the two follow-ups below are P1.
      _Links:_ [input-system.md](input-system.md)
- [ ] **Audio (core)** — ❌ Audio HAL + Web Audio backend.
      _AC:_ `AudioClip` importer + asset kind (.wav/.ogg/.mp3) with `.meta`; `AudioSource`
      (play/pause/volume/pitch/loop) + `AudioListener` components; one-shot and looping playback;
      reflection schemas registered by the plugin; a sample plays SFX + music. (Mixer buses → P1.)
      _Links:_ [audio.md](audio.md)
- [ ] **Physics** — ❌ `packages/physics-core` (abstraction) + `packages/physics-rapier` (backend).
      _AC:_ physics-core leaf with a `PhysicsBackend` interface + `PhysicsCapabilities`; **Avian-shaped,
      `2d`/`3d`-suffixed** components (`RigidBody2d/3d`, `Collider2d/3d`, `LinearVelocity2d/3d`,
      `AngularVelocity2d/3d`, `ExternalForce*`, `Restitution`/`Friction`/`GravityScale`, `Sensor`, joints),
      reflection-registered; physics-rapier over `@dimforge/rapier2d-compat` + `rapier3d-compat` with a
      Sync→Step→Writeback bridge + entity↔body maps; `PhysicsPlugin` steps inside the **fixed timestep**,
      backend **injected at App startup**; collision start/end events + raycast/shapecast query service; a
      demo where bodies fall, collide, and a character controller moves. Write a new ADR when work starts.
      _Links:_ new — create `physics.md` + an ADR on start. (design recorded in [`../reference/engine-core.md`](../reference/engine-core.md))
- [ ] **In-game UI (core) — "Retro CSS"** — ❌ `packages/ui`: retained ECS UI (Unity-UITK model + Bevy
      `UiSurface` mechanism).
      _AC:_ `UiNode` + derived `ComputedLayout` (not serialized) reusing `Parent`/`Children`; a pure-TS
      **flexbox** `LayoutEngine` behind an interface, with a text-measure callback; a `.rss` (USS-subset)
      parser + style-resolution system matching type / `.class` / `#name` / **state-marker** selectors
      with cascade + inheritance; pseudo-class markers (`Hovered`/`Focused`/`Pressed`/`Disabled`/`Checked`);
      `--vars` via a theme resource; render through the 2D pipeline (quads + MSDF glyphs); minimal widgets
      (panel/label/button/image); a HUD scene laid out with flex and styled by `.rss`. (Grid, virtualized
      list/tree, data binding, spatial nav → P1.) Depends on **Text rendering** below.
      _Links:_ [ui-system.md](ui-system.md)

## Renderer

- [ ] **Engine text rendering (MSDF)** — ❌ game-facing text (only the ImGui editor overlay exists today).
      _AC:_ MSDF glyph atlas (generated via msdfgen, loaded as an asset) + runtime glyph-quad batching
      through the 2D pipeline; `Text`/`Text2d` components; font asset kind + `.meta`; layout
      (line-break/wrap/alignment); glyph metrics exposed to the UI layout measure callback; crisp at any
      scale/rotation; a sample draws multi-line styled text. (Required by in-game UI.)
      _Links:_ new — folds into [ui-system.md](ui-system.md)

## Editor / Studio

- [ ] **Play mode (snapshot / restore / step)** — 🟡 `SimState` exists; no snapshot, Step is dead.
      _AC:_ snapshot the authored scene on Play (serialize world), restore it exactly on Stop (no leaked
      play-time edits); **Step** advances exactly one frame while paused (wire the dead Run-menu/toolbar
      buttons); systems gate correctly by `SimState`; inspector shows live values during play.
      _Links:_ [play-mode.md](play-mode.md) · [`../backlog/studio-playmode-snapshot-restore.md`](../backlog/studio-playmode-snapshot-restore.md)

## Platform / Tooling

- [ ] **Export — Web target + `.rpak` foundation** — ❌ no game ship pipeline (builds only run in-studio).
      _AC:_ `packages/build` (Bun/Node-only) with an `ExportTarget` interface + registry and a shared Bun
      bundler for user code (engine externalized appropriately); a **web adapter** emitting a static site
      (engine + user bundle + `.rpak`) that runs in a browser; a **`.rpak` writer** (magic+version header →
      GUID-keyed TOC {offset/len/codec/hash} → per-asset-compressed blobs) + a runtime reader that streams
      via **HTTP Range** and lazy-loads per GUID (fits the existing GUID + manifest model); a real small
      project exports and runs from the produced artifact.
      _Links:_ [web-build-target.md](web-build-target.md)

## Stabilization (engine freezers)

- [ ] **Fix: mesh missing a required attribute freezes the renderer** — 🟡.
      _AC:_ a mesh missing a shader-required attribute (e.g. `TEXCOORD_0`) no longer freezes rendering —
      validated fallback or skipped draw + one dev warning; the prior repro renders.
      _Links:_ [`../bugs/mesh-without-uv-freezes-renderer.md`](../bugs/mesh-without-uv-freezes-renderer.md)
- [ ] **Fix: malformed material uniform breaks the render loop** — 🟡.
      _AC:_ a wrong-shaped `StandardMaterial` field is rejected/coerced with a dev warning instead of
      breaking the whole render loop; the prior repro renders.
      _Links:_ [`../bugs/malformed-material-uniform-breaks-render-loop.md`](../bugs/malformed-material-uniform-breaks-render-loop.md)

---

# P1 — Important

## Engine

- [ ] **Input follow-ups** — three additive extensions on the shipped `@retro-engine/input`
      (ADR-0144/0145/0146): (a) **gamepad bindings in the action map** — an `ActionBinding` `'gamepad'`
      device + analog-axis sources so gamepad is rebindable through `ActionMap` (currently read directly
      via `Gamepads`); (b) **touch gesture recognizers** — tap / pan / pinch / swipe on top of `Touches`;
      (c) **studio binding editor** (Phase 5) — edit the `ActionMap` live + an MCP command.
      _Links:_ [input-system.md](input-system.md)
- [ ] **CSS Grid for the UI layout engine** — pure-TS grid behind the `LayoutEngine` interface (Taffy-WASM
      only as a fallback escape hatch). _Links:_ [ui-system.md](ui-system.md)
- [ ] **In-game UI depth** — virtualized list/tree views, data binding, more widgets
      (toggle/slider/scrollview/text-input/dropdown/tabs), spatial navigation, screen management.
      _Links:_ [ui-system.md](ui-system.md)
- [ ] **Audio mixer buses** — bus routing, per-bus volume, basic spatial panning. _Links:_ [audio.md](audio.md)
- [ ] **Windowing** — `Window` resource, cursor/fullscreen/present-mode(vsync), multi-window, window events.
- [ ] **Diagnostics store** — `DiagnosticsStore` (FPS/frame-time/entity-count/asset counts) + overlay.
- [ ] **ECS ordering depth** — `SystemSet` + set-level config/run-conditions + `.chain()` + ambiguity
      detection; exclusive systems (`&mut World` param); explicit state-transition ordering.
      _Links:_ [system-params.md](system-params.md) · [`../backlog/explicit-state-transition-ordering.md`](../backlog/explicit-state-transition-ordering.md)
- [ ] **System-param sugar** — `Local<T>`, reader/writer/trigger sugar. _Links:_ [system-params.md](system-params.md)
- [ ] **Texture import settings (`.meta`)** — filter (nearest/point·bilinear·trilinear), wrap, color space
      (sRGB/linear), mipmaps, max size, PPU; consumed by `RenderImage` sampler/upload. **High-value + cheap
      — required for crisp pixel-art; consider pulling into P0.**
- [ ] **Sprite definitions (`.meta`, Unity-style)** — single/multiple mode, grid + manual-rect slicing,
      pivot/border(9-slice)/PPU; sliced sprites minted as sub-assets via composite GUID (ADR-0126),
      feeding `TextureAtlasLayout` (ADR-0032) + 9-slice (ADR-0034). Authored via the Sprite Editor (Editor).
- [ ] **Scenes/prefabs follow-ups** — nested-scene per-instance overrides; hot-reload removal of user
      observers/hooks + selection remap.
      _Links:_ [scenes-and-prefabs.md](scenes-and-prefabs.md) · [`../backlog/nested-scene-instance-overrides.md`](../backlog/nested-scene-instance-overrides.md) · [`../backlog/hot-reload-observer-hook-removal.md`](../backlog/hot-reload-observer-hook-removal.md)

## Renderer

- [ ] **WebGL2 backend + portable shaders** — 🔩 stub. Build out `renderer-webgl2`; WGSL→GLSL via naga;
      capability-gate every WebGPU-only feature (§5.4). **P1-high: hard blocker for Linux/Android/older-Apple
      export** (their Tauri webview has no WebGPU) — must ship before those targets leave experimental.
      _Links:_ [portable-shaders.md](portable-shaders.md)
- [ ] **Clustered forward+** — many-light scaling (SSBO/`storageBuffers`-gated).
      _Links:_ [`../backlog/3d-clustered-forward-plus.md`](../backlog/3d-clustered-forward-plus.md)
- [ ] **Deferred prepass** — complete the `DeferredPrepass` path. _Links:_ [renderer.md](renderer.md)
- [ ] **Culling / LOD** — `VisibilityRange` distance culling + LOD; activate retained instance prep + spatial
      acceleration; instanced mesh-material perf.
      _Links:_ [`../backlog/visibility-range.md`](../backlog/visibility-range.md) · [`../backlog/retained-instance-prep-and-spatial-culling.md`](../backlog/retained-instance-prep-and-spatial-culling.md) · [`../backlog/instanced-mesh-materials.md`](../backlog/instanced-mesh-materials.md) · [`../backlog/event-driven-cull-prepares-followups.md`](../backlog/event-driven-cull-prepares-followups.md)
- [ ] **Shadow/lighting follow-ups** — point/cube shadows, PCSS/temporal PCF, per-light split ranges,
      per-cascade culling/bias, per-camera/per-light PCF overrides. _Links:_ [renderer.md](renderer.md)
- [ ] **Prepass/AO/IBL follow-ups** — alpha-masked prepass coverage; GTAO visibility integral +
      sub-viewport/orthographic AO; configurable IBL radiance clamp.
      _Links:_ [`../backlog/alpha-masked-prepass-coverage.md`](../backlog/alpha-masked-prepass-coverage.md) · [`../backlog/ao-gtao-visibility-integral.md`](../backlog/ao-gtao-visibility-integral.md) · [`../backlog/ao-subviewport-and-orthographic.md`](../backlog/ao-subviewport-and-orthographic.md) · [`../backlog/ibl-radiance-clamp-configurable.md`](../backlog/ibl-radiance-clamp-configurable.md)
- [ ] **HAL: viewport/scissor + gizmo line width** — dynamic `setViewport`/`setScissorRect`; thicker/AA
      gizmo lines via instanced quads.
      _Links:_ [`../backlog/render-pass-viewport-scissor.md`](../backlog/render-pass-viewport-scissor.md) · [`../backlog/gizmo-line-width-instanced-quads.md`](../backlog/gizmo-line-width-instanced-quads.md)

## Editor / Studio

- [ ] **Multi-select + multi-object editing** — rubber-band select; multi-target gizmo + inspector
      (the gizmo core already supports N targets).
- [ ] **Scene file actions** — New / Open / Save-As (wire the dead menu items).
      _Links:_ [`../backlog/scene-file-actions.md`](../backlog/scene-file-actions.md)
- [ ] **Clipboard** — cut/copy/paste/duplicate entities and component values.
- [ ] **Asset browser actions** — import-from-OS UI, reimport, duplicate, create-material; asset file-op
      undo; asset-picker multi-select / popover / tags+favorites.
      _Links:_ [`../backlog/asset-file-op-undo.md`](../backlog/asset-file-op-undo.md) · [`../backlog/asset-picker-multi-select.md`](../backlog/asset-picker-multi-select.md) · [`../backlog/asset-picker-popover-layout.md`](../backlog/asset-picker-popover-layout.md) · [`../backlog/asset-picker-tags-and-favorites-persistence.md`](../backlog/asset-picker-tags-and-favorites-persistence.md)
- [ ] **Sprite Editor UI** — slice textures (grid + manual rects), set pivot/border/PPU, writing sprite
      defs into `.meta` and minting sub-asset sprites (currently a `console.info` stub).
- [ ] **Material / shader node editor** — the editor front-end for the Visual shader graph (Renderer P2):
      wire a real material consumer onto the graph-editor toolkit.
- [ ] **Animation clip / dope-sheet / curve editor** — author `AnimationClip` keyframes (only the controller
      graph editor exists today).
- [ ] **Tilemap editor + runtime** — 2D tile authoring + chunk rendering.
- [ ] **Project Settings persist & apply** — the dialog renders but Save is a no-op.
      _Links:_ [`../backlog/editor-human-readable-settings.md`](../backlog/editor-human-readable-settings.md)
- [ ] **Rendered thumbnails + cache** — enable in-engine lit thumbnails (`RENDERED_THUMBNAILS=false`); add
      on-disk thumbnail cache + geometry previews.
      _Links:_ [`../backlog/asset-thumbnail-cache-and-geometry-previews.md`](../backlog/asset-thumbnail-cache-and-geometry-previews.md) · [`../backlog/backgrounded-screenshot-gpu-readback.md`](../backlog/backgrounded-screenshot-gpu-readback.md)
- [ ] **MCP expansion** — `assets.import`, `animController.*`, `studio.run_tests`, per-connection token
      hardening; animation-controller live-debug during play.
      _Links:_ [studio-mcp.md](studio-mcp.md) · [`../backlog/animation-controller-mcp-commands.md`](../backlog/animation-controller-mcp-commands.md) · [`../backlog/animation-controller-live-debug.md`](../backlog/animation-controller-live-debug.md)
- [ ] **Inspector depth** — reference pickers + structural (array/component) edits; per-field reset;
      component reorder; decorator sugar; Add-Component category metadata; hierarchy sibling reordering;
      gizmo↔selection bridge.
      _Links:_ [`../backlog/inspector-reference-pickers.md`](../backlog/inspector-reference-pickers.md) · [`../backlog/inspector-decorator-sugar.md`](../backlog/inspector-decorator-sugar.md) · [`../backlog/add-component-category-metadata.md`](../backlog/add-component-category-metadata.md) · [`../backlog/hierarchy-sibling-reordering.md`](../backlog/hierarchy-sibling-reordering.md) · [`../backlog/gizmo-selection-bridge.md`](../backlog/gizmo-selection-bridge.md)

## Platform / Tooling

- [ ] **Export — Desktop (Tauri win/mac/linux)** — per-OS bundles via a **CI matrix** (no cross-compile);
      native `.rpak` streaming via a Tauri custom URI-scheme + mmap (one HTTP-Range loader path shared with
      web). _Links:_ [web-build-target.md](web-build-target.md)
- [ ] **Integrated frame benches** — per-system cost attribution in the bench suite (CLAUDE.md §11).
      _Links:_ [`../backlog/integrated-frame-benches.md`](../backlog/integrated-frame-benches.md)

## Stabilization (P1 bugs)

- [ ] **MCP `entity.despawn` dropped by a later `scene.save`.** _Links:_ [`../bugs/mcp-entity-despawn-not-reflected-in-scene-save.md`](../bugs/mcp-entity-despawn-not-reflected-in-scene-save.md)
- [ ] **MCP `component.set` corrupts entity-ref + vec3 fields.** _Links:_ [`../bugs/studio-mcp-component-set-entity-and-vec3.md`](../bugs/studio-mcp-component-set-entity-and-vec3.md)
- [ ] **`MaterialPlugin.queueMaterials3d` lacks a camera sub-graph filter.** _Links:_ [`../bugs/material-plugin-camera-subgraph-filter.md`](../bugs/material-plugin-camera-subgraph-filter.md)
- [ ] **Inspector transform fields round small values to 0** (FBX→glTF cm→m scales). _Links:_ [`../bugs/inspector-transform-fields-round-small-values-to-zero.md`](../bugs/inspector-transform-fields-round-small-values-to-zero.md)
- [ ] **OBJ base mesh swaps NORMAL/UV attribute order.** _Links:_ [`../bugs/obj-base-mesh-normal-uv-attribute-order.md`](../bugs/obj-base-mesh-normal-uv-attribute-order.md)

---

# P2 — Nice-to-have

## Engine

- [ ] **Generic relationships** — Bevy 0.16-style arbitrary bidirectional relations (today only `Parent`/`Children`).
- [ ] **Generic sub-apps API** — arbitrary sub-apps with their own schedules (today only the render world).
- [ ] **Parallel executor / task pools** — multithreaded schedule + async compute; async asset-processing pipeline.
- [ ] **Computed/sub-states + `StateScoped` entities** — beyond per-pair transitions + state-scoped resources.
- [ ] **Math depth** — curves/splines, easing, noise/random, color-space conversions, OBB/bounding-sphere.
      _Links:_ [transform-and-hierarchy.md](transform-and-hierarchy.md)

## Renderer

- [ ] **GPU-driven & compute** — HAL compute path (`createComputePipeline`/dispatch) + indirect/multi-draw,
      gated on `computeShaders`/`indirectDraw` (§5.4, **WebGPU-only**); unlocks GPU culling, occlusion
      culling, meshlets, light clustering, GPU particles, compute GTAO.
      _Links:_ [`../backlog/ao-compute-gtao.md`](../backlog/ao-compute-gtao.md)
- [ ] **Post-FX (fidelity)** — bloom, depth of field, SSR/SSGI, auto-exposure, color grading/LUT
      (tony_mc_mapface), FXAA/SMAA, chromatic aberration, OIT.
      _Links:_ [renderer.md](renderer.md) · [`../backlog/tonemapping-tony-mcmapface.md`](../backlog/tonemapping-tony-mcmapface.md)
- [ ] **Sky / atmosphere / volumetrics** — procedural atmospheric sky (day/night), volumetric fog &
      lighting, god rays.
- [ ] **Particles** — CPU particles (portable, WebGL2-safe) + GPU particles (compute-driven, WebGPU-only,
      `computeShaders`-gated); emitters/modules.
- [ ] **Light probes / irradiance volumes / lightmaps** — needs baking infrastructure.
- [ ] **Visual shader graph** — node-graph material authoring on the graph-editor toolkit (ADR-0137/0143) →
      WGSL codegen (+ GLSL via naga for WebGL2), behind `ExtendedMaterial`. Pairs with the editor
      Material/shader node editor. *User-flagged "eventually a must."*
- [ ] **Decals, terrain, water** — new subsystems.
- [ ] **Texture compression + mipmap gen** — BCn/ASTC/ETC; mip generation helper.
- [ ] **Raytraced GI (Solari-style)** — far future; RT/compute-gated.

## Editor / Studio

- [ ] **Timeline / cutscene sequencer** — track-based (animation / audio / activation / signal tracks);
      editor authoring + runtime playback.
- [ ] **Editor flexbox/grid layout helper** — ~200-line immediate-mode flex solver over ImGui (Clay-style
      `FIXED/GROW/FIT/PERCENT`) so panels/toolbars express "row, these left, justify rest to end, fill
      remaining" without hand-computed pixels; **shares the in-game UI pure-TS flex core**. (Editor-focused.)
- [ ] **Atlas / particle / VFX editors** — authoring UIs.
- [ ] **RetroHuman dedicated editor** — isolated preview, textured + sliders, Save → bake mesh + GLB export.
      _Links:_ [retrohuman-editor.md](retrohuman-editor.md)
- [ ] **Terrain / navmesh / audio-mixer / UI-canvas editors** — authoring surfaces for those subsystems.
- [ ] **VCS integration + global project search.**

## Platform / Tooling

- [ ] **Export — Mobile (Tauri iOS/Android)** — App Store / Play packaging; **depends on WebGL2** (no
      WebGPU in the mobile webview). _Links:_ [web-build-target.md](web-build-target.md)
- [ ] **Release automation** — provenance, changelog, snapshot releases, code signing, auto-update.
      **Do not start before 0.1.0.** _Links:_ [release-automation.md](release-automation.md)

## Gameplay / AI

- [ ] **Navmesh + AI agents** — navmesh generation, nav-agent component, pathfinding. *(User: less
      important than core physics.)*
- [ ] **Concave / mesh colliders** — beyond the P0 primitive colliders. *(User: less important than the
      entirety of 2D/3D physics.)*

---

## Explicitly out of scope for now

Not requested and not planned; recorded so their absence is a decision, not an oversight. Promote to a
tier if/when they're wanted.

- **Networking / replication** (Bevy leaves this to the ecosystem too).
- **Localization / i18n.**
- **In-studio code editor** — locked out by decision; users bring an external IDE (ADR-0090 family).

---

## Coverage note

Built from a full audit of the codebase (renderer / engine / studio inventories), the existing 145
ADRs + 46 backlog + 27 roadmap + 7 bug files, and a Bevy-parity catalog. Every 🔩/❌/🟡 in
[`../reference/`](../reference/README.md) has a home above. When adding items, link existing
`../backlog/` and `../roadmap/` files rather than duplicating them.
