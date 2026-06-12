# Roadmap Horizons

A lightweight index over `docs/roadmap/`. Tells you what's active right now, what's likely next, and what's parked as a future-direction sketch.

This file is the answer to "what should I work on?" — not by listing every initiative in priority order (the dependencies are too dense for a flat list), but by surfacing the *current milestone* and being honest about which other files are real plans vs sketches kept on paper for later.

## Honest disclaimer

Most files in this folder are **sketches**, not researched plans. They capture intent at the time of writing. A file becomes a plan when its phases get promoted into concrete `docs/backlog/*.md` items with acceptance criteria. Until then, treat a sketch as an idea worth keeping, not as a commitment.

`scenes-and-prefabs.md` is the roadmap file currently promoted — its phase-1 slice points to a real backlog item (`scenes-as-loadable-assets.md`) sealed by ADR-0062, building on the now-landed reflection foundation (ADR-0060/0061). Everything else is a sketch (some more researched than others) waiting for promotion when its turn comes. The earlier foundations, renderer, and asset-system milestones were worked through and their umbrella roadmap files retired or partially deferred as the work landed (see below).

## Current milestone

**Scenes & Prefabs (through composition).** See `scenes-and-prefabs.md` for the umbrella; phase 1 + the load/unload lifecycle sealed by **ADR-0062**, prefab templates/patches by **ADR-0067** (`docs/backlog/prefab-templates-and-patches.md`), scene composition by **ADR-0071**.

This makes scenes *real*: a `Scene` is a loadable asset (`Assets<Scene>` + a `.scene` JSON importer/serializer, opt-in `ScenePlugin`), a `SceneRoot` component + reactor instantiate it once ready (mirroring the glTF precedent, ADR-0057), and `App.addScene(state, handle)` gates the whole graph behind a `States` value — spawning on `OnEnter`, tearing down cleanly on `OnExit`. Handle resolution became automatic shortly after via the App's asset stores (ADR-0065) and a loadable manifest read path (ADR-0066), prefab templates/patches — named, parameterized recipes spawnable, patchable, and embeddable-by-name in a scene — landed on top (ADR-0067), and inline observer binding — a scene attaches observers to its entities by referencing registered handler names — landed on the existing observer runtime (ADR-0068). Scene composition (ADR-0071) then made a scene nestable inside another: a mount entity points at a child scene by GUID, instantiated live under it by the same reactor — a Godot/Unity-style live link (saving re-emits the ref, the child stays an editable asset), the same child instanceable many times, each named and positioned by its mount. Hot-reload, per-instance nested overrides, and registering the remaining components stay reserved.

### Completed before this

- **Reflection & Serialization (v1 + engine retrofit)** — the `@retro-engine/reflect` package (`TypeRegistry` by stable name, the typed `t` vocabulary, JSON codec) plus the world↔scene serializer, the per-App `AppTypeRegistry`, and the hook-firing `spawnScene` that rebuilds hierarchy from the `Parent` edge (ADR-0060, ADR-0061). The spawn primitive scenes-and-prefabs now builds on. Decorators, change-detection-by-name, the studio inspector, and registering every remaining component stay reserved.
- **Asset System (runtime core + persistent save tier)** — `Assets<T>` stores, handles, the asset server + loaders, and the dependency-aware load context landed (ADR-0055, ADR-0056), with glTF/GLB import on top (ADR-0057, ADR-0059). The persistent project tier then shipped browser-first: automatic in-memory GUID resolution (ADR-0065), the manifest read path (ADR-0066), and the write/save half (ADR-0070) — `serializeProject` emits a `.retro-project` as pure data, written through a swappable `AssetSink` (the v1 `HttpPostAssetSink` pairs with `FetchAssetSource` for a browser→disk→browser round-trip), with promotion + `.meta` sidecars. Native `DiskAssetSource` / `BundleAssetSource` and studio integration stay deferred as `asset-system.md` phase 6.
- **M2 — Engine Foundations** (ADRs 0005–0011) is sealed; its backlog items landed and were removed. Design posture carried forward: single-threaded throughout (TypeScript reality), `Transform` is one component for 2D and 3D, Required Components is the primary spawn mechanism, `States` + `runIf` is the scoping primitive, scenes/prefabs are *ours* (BSN-inspired, in-house), Plugin has a full `build`/`ready`/`finish`/`cleanup` lifecycle.
- **Renderer** (ADRs ~0018–0054) landed a large body of work — HAL, render world + sets, cameras/visibility, mesh/material/sprite pipelines, 2D/3D lighting + shadows, HDR/tonemapping, the screen-space prepass family, TAA, and SSAO. `renderer.md` is the long-horizon umbrella; remaining renderer follow-ups live as individual backlog items.

## Imminent

With scene-as-asset + the lifecycle, automatic GUID resolution + the manifest read path (ADR-0065/0066), prefab templates/patches (ADR-0067), inline observer binding (ADR-0068), resource reflection (ADR-0069), the persistent write/save half (ADR-0070), and scene composition (ADR-0071) all landed, the next steps build on them: `scenes-and-prefabs.md` phase 7 (hot-reload — save was its prerequisite), the deferred per-instance nested-scene overrides (`docs/backlog/nested-scene-instance-overrides.md`, the provenance-component work toward the editor), and the native disk/bundle sinks + studio integration (`asset-system.md` phase 6). The observer *runtime* phase 5 builds on is already shipped (ADR-0013); the `observers-and-events.md` sketch is now just naming/`Message`-vs-`Event` polish. Further `reflection-and-serialization.md` phases (decorators as sugar, change-detection-by-name) and registering the remaining components promote as consumers demand them.

## Future direction (sketches, kept on paper)

Each link below is a sketch. Some are tightly scoped, some are speculative. None are ready to execute without further research and promotion.

- `audio.md` — HAL-shaped audio backend, mixer buses, spatial audio.
- `change-detection.md` — `Changed<T>` / `Added<T>` query filters, generation counters. Designed alongside M2; impl deferred until a real consumer.
- `ecs-storage.md` — perf + ergonomics beyond the M2 archetype baseline (sparse-set sidecar, fragmentation under thousands of archetypes, benchmarks).
- `editor-sdk.md` — extension surface for the studio (custom windows, inspectors, asset importers).
- `input-system.md` — platform-agnostic input HAL, action bindings, gamepad, touch.
- `observers-and-events.md` — observer + hook system, `Message<T>` vs `Event<T>` naming, `Trigger<E>` param.
- `playground-app.md` — beyond the M1 scaffolding: example scenes, production build target.
- `release-automation.md` — provenance, code signing, auto-update. Gated on the first 0.1.0 publish.
- `renderer.md` — consolidated long-horizon renderer roadmap (foundations → sprites/materials → lights/glTF → post → GPU-driven → WebGL2 → tooling). Supersedes the earlier `first-render-path.md`, `renderer-graph.md`, and `webgl2-backend.md` sketches.
- `scenes-and-prefabs.md` — our scene + prefab system, BSN-inspired but designed in-house. **Phase 1 + the lifecycle (ADR-0062), templates/patches (ADR-0067), inline observer binding (ADR-0068), and composition (ADR-0071) shipped**; the remaining phases (hot-reload, studio) are still sketches.
- `studio-imgui.md` — jsimgui integration with the engine's WebGPU canvas.
- `studio-mcp.md` — MCP server exposing studio internals to AI agents.
- `system-params.md` — additional param kinds beyond the M2 core set (`Local<T>`, `MessageReader/Writer<T>`, observers-as-params).
- `transform-and-hierarchy.md` — extensions beyond the M2 base (Z-ordering, hierarchy ergonomics, optimization passes).
- `ui-system.md` — in-game UI separate from studio ImGui; headless widgets + theming.
- `web-build-target.md` — bundle a project into a deployable static web build.

## Update rule

This file is updated when:

1. A milestone starts or ends.
2. A roadmap file is promoted from "Future direction" to active (its phases land in `docs/backlog/`).
3. A new roadmap file is created.

This file is **not** updated for: edits inside an existing roadmap file, status flips within an initiative, backlog churn. The backlog is the source of truth for in-flight work; this file is the index over the roadmap layer above that.

## See also

- `docs/roadmap/README.md` — folder lifecycle and procedural rules.
- `docs/backlog/README.md` — what goes in the backlog and when it gets deleted.
- `docs/adr/README.md` — the sealed-decisions record.
