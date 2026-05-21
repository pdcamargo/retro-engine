# @retro-engine/studio

Retro Engine's desktop editor app. Tauri 2.x shell, Bun frontend, jsimgui UI, hosts the engine on a WebGPU canvas.

## Develop

From the repo root:

```sh
bun install
cd apps/studio
bun run tauri:dev
```

First run requires the Rust toolchain (`rustup`). The Tauri shell lives in `src-tauri/` — see [Initial Tauri setup](#initial-tauri-setup) if cloning fresh and that folder is missing.

## Build a release bundle

```sh
bun run tauri:build
```

Bundles land in `src-tauri/target/release/bundle/`.

## Releases

Push a tag matching `studio-v*` (e.g. `studio-v0.3.0-beta.1`) to trigger [`.github/workflows/studio-release.yml`](../../.github/workflows/studio-release.yml), which builds on `windows-latest`, `macos-latest`, and `ubuntu-latest` and attaches bundles to a GitHub Release.

## Initial Tauri setup

If `src-tauri/` does not exist yet, run from `apps/studio/`:

```sh
bunx @tauri-apps/cli@latest init --ci \
  --app-name studio \
  --window-title "Retro Engine Studio" \
  --frontend-dist ../dist \
  --dev-url http://localhost:1420 \
  --identifier dev.retro-engine.studio
```

Then in `src-tauri/tauri.conf.json` set:

```json
"build": {
  "beforeDevCommand": "bun run dev",
  "beforeBuildCommand": "bun run build",
  "devUrl": "http://localhost:1420",
  "frontendDist": "../dist"
}
```

## Naming

The shipping desktop app is called **studio**, not `editor`. `editor` is reserved as a *namespace* for packages: future `@retro-engine/editor-sdk`, `editor-runtime`, `editor-cli`. See [ADR-0001](../../docs/adr/ADR-0001-architecture-foundations.md).

## Planned: AI MCP server

Studio will host an MCP server so AI coding agents can drive editor-side work (scene mutation, world queries, screenshots, running tests) instead of being limited to filesystem edits. Mirrors the Unity MCP posture from the platformer-builder project. Planning lives in [`docs/roadmap/studio-mcp.md`](../../docs/roadmap/studio-mcp.md); CLAUDE.md will pick up an "Editor tooling (MCP)" section when the server actually exists.
