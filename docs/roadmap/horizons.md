# Roadmap Horizons

A lightweight index over `docs/roadmap/`. Tells you what's active right now, what's likely next, and what's parked as a future-direction sketch.

This file is the answer to "what should I work on?" — not by listing every initiative in priority order (the dependencies are too dense for a flat list), but by surfacing the *current milestone* and being honest about which other files are real plans vs sketches kept on paper for later.

## Honest disclaimer

Most files in this folder are **sketches**, not researched plans. They capture intent at the time of writing. A file becomes a plan when its phases get promoted into concrete `docs/backlog/*.md` items with acceptance criteria. Until then, treat a sketch as an idea worth keeping, not as a commitment.

`engine-foundations.md` is the only roadmap file in this repo that has been promoted end-to-end — every phase points to a real backlog item. Everything else is a sketch (some more researched than others) waiting for promotion when its turn comes.

## Current milestone

**M2 — Engine Foundations.** See `engine-foundations.md` for the umbrella; phases live in `docs/backlog/*.md`:

- `system-param-protocol.md`
- `engine-resource-registry.md`
- `engine-time-resource.md`
- `ecs-archetype-world.md`
- `engine-schedule-and-states.md`
- `engine-commands-buffer.md`
- `transform-hierarchy.md`
- `engine-plugin-lifecycle.md`

The M2 design posture: single-threaded throughout (TypeScript reality), `Transform` is one component used for 2D and 3D, Required Components is the primary spawn mechanism, `States` + `runIf` is the system/resource scoping primitive, scenes and prefabs are *ours* (BSN-inspired but designed in-house), Plugin gets a full lifecycle (`build` / `ready` / `finish` / `cleanup`).

## Imminent

To be picked once M2 phases start landing. Candidates currently include sprite rendering (the natural next pressure on the renderer HAL), input, and the first scene/prefab work. M3's exact shape is decided at the end of M2, not now.

## Future direction (sketches, kept on paper)

Each link below is a sketch. Some are tightly scoped, some are speculative. None are ready to execute without further research and promotion.

- `asset-system.md` — GUID-handle asset store, importer/serializer registry, project format.
- `audio.md` — HAL-shaped audio backend, mixer buses, spatial audio.
- `change-detection.md` — `Changed<T>` / `Added<T>` query filters, generation counters. Designed alongside M2; impl deferred until a real consumer.
- `ecs-storage.md` — perf + ergonomics beyond the M2 archetype baseline (sparse-set sidecar, fragmentation under thousands of archetypes, benchmarks).
- `editor-sdk.md` — extension surface for the studio (custom windows, inspectors, asset importers).
- `input-system.md` — platform-agnostic input HAL, action bindings, gamepad, touch.
- `observers-and-events.md` — observer + hook system, `Message<T>` vs `Event<T>` naming, `Trigger<E>` param.
- `playground-app.md` — beyond the M1 scaffolding: example scenes, production build target.
- `reflection-and-serialization.md` — decorator-based component reflection, `TypeRegistry` equivalent, scene format. Foundation for scenes/prefabs.
- `release-automation.md` — provenance, code signing, auto-update. Gated on the first 0.1.0 publish.
- `renderer.md` — consolidated long-horizon renderer roadmap (foundations → sprites/materials → lights/glTF → post → GPU-driven → WebGL2 → tooling). Supersedes the earlier `first-render-path.md`, `renderer-graph.md`, and `webgl2-backend.md` sketches.
- `scenes-and-prefabs.md` — our scene + prefab system, BSN-inspired but designed in-house.
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
