# ADR-0099: Native runtime hardening (binary IPC, per-project scope, boot root, fs watch)

- **Status:** Accepted
- **Date:** 2026-06-19

## Context

ADR-0088…0098 built the standalone-studio "open / build / index / run a project" layer and
landed it gate-green and unit/integration-tested, but **never runtime-verified** — no one had
run `tauri dev`/`tauri build` end-to-end with a real Bun sidecar. ADR-0093 and ADR-0096 each
recorded known sharp edges left for a hardening pass: project file bytes crossed the IPC
boundary as JSON number arrays, the asset-protocol and fs-watch scopes were the broad v0
`$HOME/**`, and the file watcher was wired but unexercised. Running the native shell for the
first time also surfaced two outright bugs.

## Decision

- **Raw-byte IPC for project files.** `project_read_file` returns `tauri::ipc::Response`
  (octet-stream, no JSON marshalling); `project_write_file` takes the bytes as the raw IPC
  request body, with the project-relative path in a percent-encoded `x-path` header. The
  frontend source/sink send/receive `ArrayBuffer` instead of `number[]`/`Array.from`. Large
  reads still stream over the asset protocol (ADR-0093); this removes the JSON round-trip for
  every structured-doc read and unblocks efficient large-binary writes.
- **Per-project runtime scope.** `set_project_root` calls `app.asset_protocol_scope()
  .allow_directory(root, true)` and `app.fs_scope().allow_directory(root, true)`, and the
  static `tauri.conf.json` asset-protocol scope + `capabilities` `fs:scope` are narrowed off
  `$HOME/**`. The webview can read/stream/watch only the opened project for the session,
  replacing the broad v0 grant.
- **Root is set on every boot that opens a project**, not only from the native dialog — a
  persisted/reopened project has no dialog, so the studio calls `set_project_root` (via the
  shared `setNativeProjectRoot`) before its first read. The dialog path routes through the same
  helper. Fixes a bug where reopened projects had no root and every native read failed.
- **The fs plugin is built with `features = ["watch"]`.** ADR-0096's watcher called the fs
  `watch` command, which is absent unless the plugin's watch feature is enabled (the
  capabilities alone are insufficient) — it failed at runtime with "Command watch not found".
  The watcher is now wired into the studio boot (reindex / reload-scene legs; the code-rebuild
  leg lands with hot reload) and fires against the opened project.
- **Webview console mirrors to the dev terminal under Tauri** (`studio_log` command +
  `mirrorConsoleToNative`), so a native session's frontend logs are observable alongside the
  Rust logs without devtools — the verification channel for a WKWebView that Playwright can't
  drive.

## Consequences

- The full native chain is proven on a live shell against `../retro-game-sample`:
  `set_project_root` + scope grant, the Bun sidecar running `bun install` + build for both
  `game.ts` and `editor.ts`, host-bridge load of `HealthPlugin`, startup-scene spawn, and the
  fs watch firing on scene + code edits.
- The asset-protocol/fs scopes are now scoped to the project, a real reduction from
  home-directory-wide access. Advances `docs/backlog/platform-filesystem-dialog-capabilities.md`
  and `studio-scene-source-host-providers.md`.
- The dev-vs-shipped build-script resolution (ADR-0092) is confirmed: under `tauri dev` the
  bundled script resolves via `BaseDirectory::Resource` (`target/debug/scripts/`).
- `tauri build` (a full installer with a per-triple Bun binary) is still unverified here; the
  remaining check is a packaged-app run, not the dev shell.

## Implementation

- `apps/studio/src-tauri/src/lib.rs` — `set_project_root` (scope grant), `project_read_file`
  (`Response`), `project_write_file` (raw `Request` body + `x-path`), `project_build` logging,
  `studio_log`
- `apps/studio/src-tauri/Cargo.toml` — `percent-encoding`; `tauri-plugin-fs` `watch` feature
- `apps/studio/src-tauri/tauri.conf.json` — asset-protocol scope narrowed; `capabilities/default.json` — `fs:scope` removed
- `apps/studio/src/project/tauri-project-io.ts` — `setNativeProjectRoot`, ArrayBuffer source/sink
- `apps/studio/src/platform/tauri-platform-host.ts` — `openProject` via `setNativeProjectRoot`
- `apps/studio/src/platform/native-console.ts` — `mirrorConsoleToNative`
- `apps/studio/src/main.ts` — boot-time `set_project_root`, console mirror, `watchProject` wiring
