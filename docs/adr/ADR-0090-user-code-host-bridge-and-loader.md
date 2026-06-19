# ADR-0090: User-code host bridge + shared-instance loader

- **Status:** Accepted
- **Date:** 2026-06-19

## Context

The standalone studio must load a user's compiled game code into the already-running
editor. User code imports `@retro-engine/*`; those imports **must** resolve to the
studio's *already-loaded* class objects, not a second bundled copy. The ECS keys
archetypes, queries, and `world.has` on the **constructor reference**, the
`AppTypeRegistry` is keyed by ctor, and `instanceof` is used throughout — so a duplicate
`Transform` class would silently fail to match. The studio frontend is bundled and
shipped, so its internal modules are not individually addressable from the outside.

The studio also has no JS runtime of its own under Tauri (addressed separately by the Bun
sidecar). For the browser/Playwright path, the existing Bun dev server can build.

## Decision

- **The studio publishes its loaded packages on a global.** `host-bridge.ts` assigns
  `globalThis.__retroHost = { '@retro-engine/engine': <namespace>, … }` from its own
  `import * as` namespaces — the studio's singletons. Called once at boot.
- **User code is bundled with a build plugin that rewrites `@retro-engine/*` to the host
  global**, not bundled. For each such import the `hostExternalsPlugin` emits a shim
  module that re-exports the named bindings from `globalThis.__retroHost[<specifier>]`.
  Export names are enumerated by importing the real package at build time, so the shim
  tracks the engine's exports automatically. Third-party imports bundle normally.
- **Build plugin over import maps.** An import map (mapping the bare specifiers to blob
  modules) was the first design, but a single import map must be installed before the
  first module load, and webview support for multiple/late maps is inconsistent across
  WKWebView/WebView2. The build-plugin approach needs no import map, works identically in
  every webview and in the browser, and uses the global as the single backing store.
- **A `ProjectBuilder` seam mirrors the platform-host pattern.** `createProjectBuilder()`
  returns a browser builder that POSTs to the dev server's `/project/build` route and
  wraps the returned JS in a blob URL; the Tauri sidecar builder slots in behind the same
  interface later. The loader dynamically imports the result and validates its default
  export is a `defineProject(...)` definition.
- **Identifier minification stays off** on this build (`--minify-whitespace
  --minify-syntax`) so component `ctor.name`s survive (ADR-0088).

## Consequences

- User code shares the studio's exact engine instances — same `Transform`, same
  `AppTypeRegistry`, same `App`. Proven headless: a built fixture's re-exported
  `Transform` is identity-equal to the studio's.
- The studio bundle carries the full `@retro-engine/*` surface (the host must provide
  everything user code might import). Acceptable for a locally loaded desktop app.
- The user project's engine version must match the studio's embedded version, or the shim
  re-exports a differently-shaped class than the user compiled against — a version-mismatch
  warning is a follow-up.
- Applying a loaded project's plugins requires a still-`Building` App, so loading a project
  is an App-rebuild (ADR for that is separate).

## Implementation

- `apps/studio/src/host-bridge.ts` — `publishHost`, `RetroHost`
- `apps/studio/src/project/host-externals-plugin.ts` — `hostExternalsPlugin`
- `apps/studio/src/project/build-project.ts` — `buildProject` (Bun-side)
- `apps/studio/src/project/project-builder.ts` — `ProjectBuilder`, `endpointProjectBuilder`, `createProjectBuilder`
- `apps/studio/src/project/load-project.ts` — `loadProjectModule`, `buildProjectModule`, `applyProject`
- `apps/studio/dev-server.ts` — `/project/build` route
- `apps/studio/src/main.ts` — `publishHost()` at boot, `__studioProject` probe
- `apps/studio/src/project/load-project.test.ts` — headless build→load→shared-identity proof
