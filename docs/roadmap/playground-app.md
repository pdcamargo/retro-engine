# Playground App

- **Created:** 2026-05-21
- **Status:** Planning

## Goal

`apps/playground` is a bare HTML page that hosts the engine in a browser, with no Tauri shell. Fast iteration loop for engine work: edit a system, refresh the browser, see the result. Also doubles as a smoke test for the browser build target — anything that breaks here breaks for end users shipping web games.

## Phases

1. **Scaffold** — `apps/playground/index.html`, `src/main.ts`, depends on `@retro-engine/engine` and `@retro-engine/renderer-webgpu` via workspace.
2. **Dev server** — Bun's dev server (or Vite if Bun's HMR isn't enough).
3. **Example scene** — minimal "spawn a few entities, render them" example, kept up to date as engine features land.
4. **Build target** — `bun build` outputs a static folder ready to deploy.
5. **Future:** ↔ link with the studio so a project can be "Play in Browser" launched into the playground.

## Open questions

- HMR: how much do we want? Full state-preserving HMR for systems is complex.
- Path resolution for assets in the browser: do we ship a manifest + fetch, or embed assets?

## Links

- ADR-0001 — engine never depends on studio; playground proves it.
- `docs/roadmap/first-render-path.md` — bootstraps Phase 1 (scaffold + dev server) of this initiative as part of standing up the first end-to-end render path.
