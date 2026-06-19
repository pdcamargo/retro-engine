# ADR-0097: Editor-extensions loading + engine-version guard

- **Status:** Accepted
- **Date:** 2026-06-19

## Context

A project may customize how the studio presents its components (custom inspectors, field
renderers) via `defineEditorExtensions` in `src/editor.ts` (ADR-0090). That code must run
**only in the studio**, never in a shipped game, and register against the studio-lifetime
inspector registry. Separately, built user code resolves `@retro-engine/*` to the studio's
embedded engine — if the project pinned a different engine line, its compiled API may not
match what the studio provides, and the user should be warned.

## Decision

- **The editor entry is a second build artifact.** The `ProjectBuilder.build(dir, entry?)`
  signature gains an optional entry (default `src/game.ts`); the dev-server route and the
  Rust `project_build` command accept it (traversal-guarded). `buildEditorExtensions`
  builds `src/editor.ts`, and `loadEditorExtensions` validates the default export is a
  `defineEditorExtensions({ setup })`.
- **The studio loads editor extensions after applying the project**, when the descriptor
  declares an `editorEntry`, and calls `ext.setup(editor.inspector)` — registering into the
  studio-lifetime registry (survives project/world reloads). A game build never builds or
  loads `src/editor.ts`.
- **An engine-version guard warns on mismatch.** `engineVersionMismatch` compares the
  project's pinned engine against the studio's embedded `STUDIO_ENGINE_VERSION` on the
  breaking segment (minor under 0.x, major at ≥1). The studio warns rather than refusing —
  the host bridge still resolves; the types just may not match.
- **Streaming posture.** The engine already loads lazily (handles reserved synchronously,
  IO drained in PreUpdate), and the native source streams large binaries over the asset
  protocol (ADR-0093). The remaining win — *stop bulk-preloading the whole manifest* and
  load only the open scene's assets on demand — is a studio runtime change that needs the
  scene-ref scan from `docs/backlog/scene-aware-asset-streaming.md`; it stays tracked there.

## Consequences

- Projects extend the editor without their custom-inspector code leaking into a game build;
  the split entry keeps `@retro-engine/editor-sdk` out of the runtime bundle.
- A version mismatch is surfaced as a console warning at load; a hard gate / auto-reinstall
  is a follow-up.
- Verified headless: an editor-extensions fixture builds, loads, and its `setup` runs
  registrations against a stub registry; the version comparator is unit-tested; `cargo
  check` confirms the `entry` parameter compiles. Live in-studio inspector customization
  needs a running shell.

## Implementation

- `apps/studio/src/project/load-project.ts` — `loadEditorExtensions`, `buildEditorExtensions`
- `apps/studio/src/project/project-builder.ts` — `build(dir, entry?)` (endpoint + tauri)
- `apps/studio/src/project/engine-version.ts` — `engineVersionMismatch`, `STUDIO_ENGINE_VERSION`
- `apps/studio/dev-server.ts` + `apps/studio/src-tauri/src/lib.rs` — `entry` param
- `apps/studio/src/main.ts` — editor-extensions load + version warning on open
- `apps/studio/src/project/{load-project,engine-version}.test.ts` — coverage
