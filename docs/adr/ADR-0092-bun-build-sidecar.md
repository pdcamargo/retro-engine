# ADR-0092: Bun build sidecar (native project build)

- **Status:** Accepted
- **Date:** 2026-06-19

## Context

Tauri ships no JS runtime, but the studio must `bun install` a user's project and bundle
its code (ADR-0090's host-resolved build). The browser path uses the dev server's
`/project/build` route; the native studio needs an equivalent that works on an end user's
machine with nothing pre-installed.

## Decision

- **Ship Bun as a Tauri sidecar.** `tauri.conf.json` declares `externalBin:
  ["binaries/bun"]`; the platform-suffixed binary is fetched per target triple in CI
  (`studio-release.yml` stages the runner's Bun as `binaries/bun-<triple>`), never
  committed. `tauri-plugin-shell` is added and initialized.
- **A `project_build` Rust command drives the sidecar.** It runs `bun install` in the
  project dir, then runs the bundled build script (`bun scripts/build-project.js --entry
  <dir>/src/game.ts`) with the project as cwd — so the host-externals plugin enumerates
  the *project's* installed `@retro-engine/*` exports (which the version pin keeps in step
  with the studio). It returns the bundle text; the frontend wraps it in a blob URL.
- **The build script is bundled to a self-contained resource.** `build-project-cli.ts`
  (which imports the studio's `buildProject` + host-externals plugin) is bundled by
  `bun run build:project-script` into `src-tauri/scripts/build-project.js` (a Tauri
  resource), so the shipped sidecar runs it with no studio-source dependency.
- **`tauriProjectBuilder` selects behind `createProjectBuilder()`** via `isTauri()`,
  lazy-importing `@tauri-apps/api/core` so the browser bundle never pulls native bindings
  (ADR-0078). The browser endpoint remains the fallback and the test path.
- **Capability:** `shell:allow-execute` scoped to the `binaries/bun` sidecar.

## Consequences

- The studio builds + installs a user's project natively with zero user-installed
  tooling. The sidecar adds the Bun binary (~tens of MB) per platform to the installer.
- Verified to the limit of a headless environment: the build script bundles to a 2 KB
  self-contained resource and produces a host-resolved bundle on the real sample project;
  `cargo check` confirms the `project_build` command, shell-plugin API, `externalBin`, and
  capability all compile/parse. Runtime (a live `tauri dev`/`tauri build` actually
  spawning the sidecar) is unverified here and is the remaining check.
- Dev vs shipped resource resolution: `BaseDirectory::Resource` resolves the bundled
  script in a shipped app and under `tauri dev`; a local `tauri build` also needs a
  `binaries/bun-<triple>` present (documented in `binaries/README.md`).

## Implementation

- `apps/studio/scripts/build-project-cli.ts` — CLI the sidecar runs; bundled to `src-tauri/scripts/build-project.js`
- `apps/studio/src/project/project-builder.ts` — `tauriProjectBuilder`, `createProjectBuilder` (isTauri-gated)
- `apps/studio/src-tauri/src/lib.rs` — `project_build` command, `tauri_plugin_shell::init()`
- `apps/studio/src-tauri/Cargo.toml` — `tauri-plugin-shell`
- `apps/studio/src-tauri/tauri.conf.json` — `externalBin`, `resources`, `beforeBuildCommand: build:tauri`
- `apps/studio/src-tauri/capabilities/default.json` — `shell:allow-execute` for the bun sidecar
- `apps/studio/src-tauri/binaries/` — sidecar drop dir (gitignored binary + README)
- `.github/workflows/studio-release.yml` — "Stage Bun sidecar" step
