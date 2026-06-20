# ADR-0102: Hot code reload via live plugin swap

- **Status:** Accepted
- **Date:** 2026-06-19

## Context

ADR-0091 made opening a project an App-rebuild (a session reload) and **deferred** hot
per-system reload, because `App.addPlugin` is legal only while the App is `Building` and a
true hot-swap needs removable/replaceable systems on a running schedule. But reloading the
whole session on every code edit is jarring — it tears down the WebGPU device, the ImGui
overlay, viewport targets, and all editor state. The desired behavior (Godot/Unity-like) is:
edit a `.ts` file, see the change live, with the editor intact.

This ADR adds the engine support ADR-0091 said was missing and overrides only that deferral;
ADR-0091's *open-project = reboot* decision still stands — this changes the
*code-edit-while-open* path from a reboot to an in-place swap.

## Decision

- **The engine gains a live plugin-swap surface, distinct from the `Building`-only path.**
  `App.addPlugin`'s guard stays loud; the swap goes through two new methods:
  - `App.removeUserPlugins(baseline)` — drops every `'user'`-origin system from every stage
    (purging its per-system buffers), unregisters the components/resources the project
    registered beyond `baseline` (the engine+editor set captured before the project loaded),
    and removes the project's plugins (`category() === 'user'`) from the registry.
  - `App.addPluginsHot(plugins)` — re-adds plugins on a running App, bypassing the `Building`
    guard, running each `build()` (attributed via the plugin-build stack so systems bucket
    correctly) then its `ready`/`finish`/`cleanup` once.
  Supporting primitives: `StageSystems.remove(pred)`, `TypeRegistry.unregister(ctor)`, and a
  `SerializeOptions.filter` to snapshot a subset of a mixed world.
- **World state survives via serialize → rebuild → respawn (not in-place migration).** The
  ECS keys on the constructor reference, so a reload's new classes (`Health` v2 `!==` v1)
  would orphan existing components. Instead the studio serializes the user scene against the
  *current* schema, tears it down, swaps plugins (re-registering the new classes under their
  stable `ctor.name`, ADR-0088), and respawns — the name-keyed codec lands the data on the new
  classes. Engine `@retro-engine/*` classes are studio singletons (ADR-0090), unchanged across
  reload, so only user classes actually swap. A user **class rename** drops those components,
  matching save-format semantics.
- **The studio orchestrates build-first, swap-on-success.** `reloadProjectCode` (driven by the
  file watcher's debounced `onRebuild`) rebuilds via the Bun sidecar; on failure it touches
  nothing and surfaces the error in the Console — a broken edit never corrupts the live
  session. On success it serializes the user scene (editor infra excluded via the
  `EditorOnly` filter, only user resources kept), despawns it, `removeUserPlugins`,
  `applyProject(..., { hot: true })` (re-applying the Play gate), and respawns. The renderer,
  ImGui overlay, viewport targets, gizmos, camera, and dock layout are never torn down.

## Consequences

- A `.ts` edit hot-swaps the rebuilt project into the running App with no page reload, editor
  state intact — verified on a live `tauri dev` shell: editing the sample's `health.ts` ran the
  rebuilt plugin's `build()` and logged `hot-reloaded` with no `set_project_root` / scene-reload
  in between; a deliberate syntax error logged `Build failed — session unchanged` and left the
  session running. Component data survives the swap (unit-tested: a value persists across a
  new-class swap).
- **Deferred (a project that uses these should not yet rely on hot reload):** global observers
  and component hooks a user plugin registers are not removed on swap, so they would stack
  across reloads; selection is cleared rather than remapped to respawned ids; editor extensions
  (`editor.ts`) are not re-run on a code edit. Tracked in
  `docs/backlog/hot-reload-observer-hook-removal.md`.
- **CLAUDE.md §13 dependency deepens:** an authored component without a reflection schema was
  previously only un-saveable; now it is also *dropped on every hot reload* (the serialize step
  skips it). The §13 note points here.

## Implementation

- `packages/engine/src/index.ts` — `App.removeUserPlugins`, `App.addPluginsHot`
- `packages/engine/src/schedule.ts` — `StageSystems.remove`
- `packages/reflect/src/type-registry.ts` — `TypeRegistry.unregister`
- `packages/engine/src/scene/serialize.ts` — `SerializeOptions.filter`
- `apps/studio/src/project/hot-reload.ts` — `reloadProjectCode`
- `apps/studio/src/project/load-project.ts` — `applyProject({ hot })` via `addPluginsHot`
- `apps/studio/src/main.ts` — watcher `onRebuild` → debounced reload + Console diagnostics
- `packages/engine/src/hot-swap.test.ts` — remove/re-add + data-preservation round-trip
