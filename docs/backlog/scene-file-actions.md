# Scene file actions — Save As, New Scene, Open Scene

- **Created:** 2026-06-20

## Context

The studio now has a working **Save Scene** (`File ▸ Save Scene` / ⌘S): it
serializes the open scene back to its own `.rescene` file by GUID and suppresses the
self-triggered watcher reload (`apps/studio/src/project/save-scene.ts`, wired in
`main.ts`). The dirty marker and the loop-safe write are in place.

The neighbouring `File` menu items remain stubs:

- **Save As…** — write the current scene to a *new* `.rescene` + `.meta` (fresh GUID
  via `generateAssetGuid`), pick a location, and optionally retarget the project's
  `startupScene`. `serializeProject` already supports an arbitrary `{ location, data }`
  with a generated GUID — this is mostly a path picker + descriptor update.
- **New Scene** — clear the user scene (preserve editor infra), reset selection +
  dirty, optionally seed a default camera/light.
- **Open Scene…** — load a different `.rescene` by GUID/path into the live world
  (reuse the `loadProjectScene` / `reloadProjectScene` machinery), with an
  unsaved-edits prompt first.

## Why deferred

The first editor-actions slice deliberately covered only the two designed features
(Save Scene + Add Component) plus dirty state. Save As / New / Open each need a
path/scene picker UI and a descriptor-update path, and Open/New want the
unsaved-edits prompt below — a coherent follow-up of their own.

## Acceptance

- `Save As…` writes a new scene file with a fresh GUID and can retarget the project
  startup scene; the new file round-trips on reload.
- `New Scene` clears the user scene to an empty (or minimal) state without touching
  editor infra, resetting dirty + selection.
- `Open Scene…` loads another scene into the live world, prompting when there are
  unsaved edits.
- Destructive actions (New / Open / project switch / window close) prompt when
  `state.dirty` — closes the long-standing "prompt before clobber" gap noted in
  `apps/studio/src/project/hot-reload.ts`.
