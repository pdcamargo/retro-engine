# Hot reload: remove user observers / hooks (+ selection remap, editor re-setup)

- **Created:** 2026-06-19

## Context

ADR-0102 shipped live plugin swap for hot code reload: a `.ts` edit rebuilds the project and
swaps its systems/components/resources into the running App, preserving world data via
serialize → respawn. A few contributions a user plugin can make are **not** yet undone on
swap, so they leak or go stale across reloads.

## Scope when picked up

- **Global observers** (`App.addObserver`) and **component hooks** (`App.registerComponentHook`)
  registered by a user plugin are not removed on `removeUserPlugins`, so they stack across
  reloads (an event fires N times after N reloads). Needs: an `ObserverRegistry.removeGlobal(id)`
  + hook-registry removal, and per-plugin tracking of what each user plugin registered (keyed off
  the plugin-build stack) so the swap can undo exactly those. This is the highest-priority gap.
- **Template / observer-handler registries**: a user plugin that registers a template or a named
  observer handler will throw on re-add (those registries reject duplicates). Add `unregister`
  to `TemplateRegistry` / `ObserverHandlerRegistry` and call them in `removeUserPlugins`.
- **Selection remap**: hot reload clears `state.selectedEntity` because respawn mints new ids;
  map the pre-swap selection forward via `spawnScene`'s id map instead of clearing.
- **Editor-extension re-setup**: an edit to `editor.ts` is not re-applied on hot reload (only
  `game.ts` plugins swap). Re-run the editor extensions' `setup` against the studio-lifetime
  inspector registry on a code change.
- **RemovedComponents flood**: tearing down the user scene on swap may surface a burst of
  removals to editor systems reading `RemovedComponents` next frame; scope/drain it.

## Acceptance

- A project that registers a global observer or component hook hot-reloads without the
  observer/hook firing extra times per reload.
- A project that registers a template or named handler hot-reloads without a duplicate-registration
  throw.
- Selection survives a hot reload when the selected entity still exists after respawn.
- Editing `editor.ts` updates the editor's custom inspectors without a full reboot.
