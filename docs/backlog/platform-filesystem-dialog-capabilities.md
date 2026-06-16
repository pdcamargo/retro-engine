# Platform filesystem + native dialog capabilities

- **Created:** 2026-06-16

## Context

ADR-0078 introduced the `PlatformHost` seam (`@retro-engine/editor-platform`) with
one capability — preferences — proven end-to-end across the browser and Tauri
hosts. The `PlatformCapabilities` struct already reserves `filesystem` and
`dialogs` flags (both `false` on every host today). The editor needs these to load
and save real projects: read asset bytes and scene documents from disk, and show
native open/save dialogs.

## Why deferred

The first slice deliberately shipped a single, low-risk capability to establish the
pattern. Filesystem + dialogs are heavier (async error handling, Tauri fs
permissions/capability scoping, native dialog plumbing) and want their own pass.
They also intersect existing engine work that should not be duplicated.

## Scope when picked up

- Extend `PlatformHost` with a filesystem capability and (separately) a dialogs
  capability, each gated by its `PlatformCapabilities` flag with a browser
  fallback — same discipline as renderer capability flags.
- **Back the engine's existing I/O seam, do not add a new one.** The native host
  produces objects satisfying the engine's `AssetSource` / `AssetSink` (ADR-0070);
  the browser side reuses the ADR-0070 `fetch` read + dev-server `PUT` write route
  (the route lives in an app, never a shipped package).
- Native host: `@tauri-apps/plugin-fs` / `@tauri-apps/plugin-dialog` (or bespoke
  commands), with the matching `src-tauri/capabilities` scopes — note plugin
  commands *do* need explicit permission entries, unlike the app-local pref
  commands.
- Keep the Tauri implementation in `apps/studio` until a second native consumer
  justifies promoting the host to its own package.

## Acceptance

- The studio can open a `.retro-project` from disk through a native dialog under
  Tauri and through the dev-server route in the browser, and save it back, using
  the engine's existing `AssetSource`/`AssetSink` — with no `@retro-engine/*`
  package importing Tauri or Node `fs`.
