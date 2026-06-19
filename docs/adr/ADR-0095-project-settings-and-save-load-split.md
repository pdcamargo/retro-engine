# ADR-0095: Project settings (TOML) + save/load ownership split

- **Status:** Accepted
- **Date:** 2026-06-19

## Context

Persistence has three distinct concerns that ADR-0078 said must not be conflated: the
project's content (scenes/assets), the user's *personal* per-project editor state, and the
human-readable *project settings* (the layer ADR-0078 deferred). Each has a different
owner, format, and home.

## Decision

- **Project settings are reflectable resources serialized to TOML.** `encodeSettingsToml`
  / `decodeSettingsToml` reuse the reflection codec (`encodeComponent`/`decodeComponent`
  with a handle/entity-free env) and `smol-toml`, so a settings resource round-trips
  exactly like a serialized scene resource — TOML is only the text encoding. These are the
  bodies of committed `editor/settings/<concern>.toml` files (travel with the project).
- **Personal per-project editor state lives in the app config, keyed by project id.**
  `projectStateKey(projectId, name)` namespaces dock layout / last scene / window state in
  the global `PreferenceStore` (the app config dir), never in the project tree (ADR-0091) —
  so it follows the user, not the repo. The studio reads the descriptor on open to get the
  project id and switches the dock-layout key per-project (global fallback when no project).
- **Content saves through the project sink.** `saveProject(app, sink, opts)` calls
  `serializeProject` (YAML scenes + `.meta`, ADR-0089) and writes each file through the
  `AssetSink` from `createProjectIo` (ADR-0093). Pure data in, files out.
- **Three homes, by owner:** global prefs (app config, follows the user) · personal
  per-project state (app config, keyed by project id) · committed settings + content (the
  project folder).

## Consequences

- The deferred human-readable settings layer exists as reflectable-resource TOML — no
  bespoke schema, and it round-trips through the same codec as scenes. Advances
  `docs/backlog/editor-human-readable-settings.md`.
- Settings carry no version/migration envelope in the file (decoded at the current
  registered version) — simple and human-clean for v0; a versioned envelope is a follow-up
  if settings shapes start churning.
- Verified headless: the settings resource round-trips through TOML (values + types
  intact) and the per-project key namespacing is asserted. Wiring the Project Settings
  dialog to specific resources and the on-open settings load are studio-runtime follow-ups.

## Implementation

- `apps/studio/src/project/settings-toml.ts` — `encodeSettingsToml`, `decodeSettingsToml`
- `apps/studio/src/project/project-state.ts` — `projectStateKey`, `get/setProjectState`
- `apps/studio/src/project/save-project.ts` — `saveProject`
- `apps/studio/src/main.ts` — per-project dock-layout key via the descriptor's project id
- `apps/studio/src/project/settings-toml.test.ts` — settings round-trip + key coverage
