# ADR-0091: Loading a project is an App-rebuild (session reboot)

- **Status:** Accepted
- **Date:** 2026-06-19

## Context

A loaded project's plugins register components, systems, and resources via
`app.addPlugin`, which the engine permits **only while the App is in its `Building`
phase** (`App.addPlugin` throws once the first `advanceFrame`/`run` has transitioned the
App to `Ready`/`Cleaned`, and the schedule freezes). The studio's `App` runs continuously
to drive the editor, so its plugins cannot be hot-added to a live App. Loading (or
switching) a project therefore cannot mutate the running App in place.

A true in-place hot-swap would require disposing and rebuilding the WebGPU device, the
ImGui overlay, every viewport target, and re-binding the history/gizmos/panels — large,
fragile, and unnecessary for the "open a project" gesture.

## Decision

- **Opening a project re-launches the studio session.** The chosen project directory is
  persisted (`retro.studio.project` preference, or a `?project=<dir>` query param for a
  launcher/test), and the studio reloads. On boot, before `app.run()` — while the App is
  still `Building` — the studio builds the project (host-bridge loader, ADR-0090) and
  `addPlugins` its definition. The project's components/systems/resources thus register
  into the live App and `AppTypeRegistry` the editor already reads (hierarchy, inspector,
  Systems panel light up with no extra wiring).
- **A page/session reload _is_ the clean App rebuild.** It reconstructs the App, renderer,
  overlay, and all editor state from scratch with the new project applied — avoiding any
  partial-teardown hazard. For a desktop editor, "open project → (re)enter the editor for
  it" is the expected model (Godot/Unity-like).
- **Hot per-system reload without a reboot is explicitly deferred** — it needs new engine
  support for removable/replaceable systems on a running schedule, which `addSystem` does
  not offer.

## Consequences

- Project load is robust and side-effect-free on the existing App: with no project set,
  boot is byte-for-byte unchanged; with one set, its plugins apply during `Building`.
- Switching projects costs a reload (sub-second for a webview). Unsaved editor state must
  be persisted before reload — handled by the per-project state work.
- The seam is small and verifiable headless: a built project's plugin, applied to a fresh
  App via `applyProject`, registers its component into the App's `AppTypeRegistry`.

## Implementation

- `apps/studio/src/project/current-project.ts` — `currentProjectDir`, `setCurrentProjectDir`
- `apps/studio/src/project/load-project.ts` — `applyProject` (addPlugins during Building)
- `apps/studio/src/main.ts` — builds + applies the current project before `run()`; `__studioOpenProject` probe (persist + reload)
- `apps/studio/src/project/load-project.test.ts` — headless proof: applied project registers its component
