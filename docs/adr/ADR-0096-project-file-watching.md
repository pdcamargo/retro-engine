# ADR-0096: Project file watching + hot reload

- **Status:** Accepted
- **Date:** 2026-06-19

## Context

With a real project on disk, edits happen outside the studio — a code file in the user's
IDE, an asset dropped in, a scene hand-edited. The studio should react: rebuild code,
re-index assets, or offer to reload a changed scene, without a manual refresh.

## Decision

- **A pure classifier routes each changed path** (`classifyChange`): code (`*.ts` …) →
  `rebuild`; scene/prefab (`*.rescene`/`*.reprefab`) → `reload-scene`; `.meta` or a known
  asset binary → `reindex`; everything else → `ignore`. Code wins, so a renamed `.ts` is
  rebuilt rather than mis-handled.
- **`watchProject(root, handlers)` watches the project root** via the fs plugin's
  `watchImmediate` (recursive), coalescing one event's paths (a `rebuild` beats a
  `reindex`) and invoking the matching handler. Returns a stop function. Native only —
  in a plain browser there is no fs watch, so it is a no-op and the studio falls back to a
  manual Reload action.
- **Reaction policy:** `reindex` re-scans the `.meta` manifest and reloads affected assets
  by GUID; `reload-scene` is **non-destructive** — it prompts rather than clobbering unsaved
  edits; `rebuild` re-bundles user code and triggers the App-rebuild (ADR-0091).
- **Capability:** `fs:allow-watch`/`fs:allow-unwatch` scoped to `$HOME/**` for v0 (the
  asset-protocol scope's sibling); `tauri-plugin-fs` initialized.

## Consequences

- External edits flow into the studio with no manual refresh; the classifier keeps the
  policy in one tested place, separate from the native watch wiring.
- Coalescing is per-event only; cross-event debouncing (storm collapsing) and `.meta`
  rename tracking are deferred. The `$HOME/**` watch scope is broad; a per-project scope is
  a follow-up alongside the asset-protocol scope tightening.
- Verified headless: the classifier is unit-tested across code/scene/asset/ignored paths;
  `cargo check` confirms the fs plugin compiles. Live watching needs a running shell.

## Implementation

- `apps/studio/src/project/watch-router.ts` — `classifyChange`, `WatchReaction`
- `apps/studio/src/project/project-watcher.ts` — `watchProject` (fs `watchImmediate`)
- `apps/studio/src-tauri/Cargo.toml` — `tauri-plugin-fs`; `src/lib.rs` — `tauri_plugin_fs::init()`
- `apps/studio/src-tauri/capabilities/default.json` — `fs:allow-watch`/`unwatch` + `$HOME/**` scope
- `apps/studio/src/project/watch-router.test.ts` — classifier coverage
