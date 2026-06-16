# ADR-0078: Studio platform-host abstraction (Tauri ⇄ browser)

- **Status:** Accepted
- **Date:** 2026-06-16

## Context

The studio runs as a web frontend that Tauri 2.x wraps in a native desktop
window, and it must *also* keep running — and stay testable with Playwright — in
a plain browser. As the editor grows it needs OS-level capabilities (persisting
window layout and editor preferences now; reading project files and showing
native dialogs later) that exist natively under Tauri but must degrade to web
equivalents in the browser.

ADR-0070 already set the precedent for the engine's I/O: serialization produces
pure data and a swappable sink/source, injected at the app layer "exactly the way
the renderer backend is", writes/reads it — and no `@retro-engine/*` package
imports Tauri or Node `fs`. What was missing was the symmetric seam for
*OS/editor* capabilities that are a studio concern (preferences, future
filesystem/dialogs), and a single decision on where the Tauri-vs-browser boundary
lives so it does not leak into the engine or get re-litigated per feature.

## Decision

- **A `PlatformHost` is injected at the app layer; the engine stays
  Tauri-agnostic.** The Tauri/browser boundary lives only in `apps/studio`, the
  one place allowed to import `@tauri-apps/api`. The engine continues to name only
  interfaces (`Renderer`, `AssetSource`/`AssetSink`, and now `PlatformHost`).
- **`@retro-engine/editor-platform`** (new leaf package, zero internal deps, no
  `@tauri-apps/*` import) owns the contract: `PlatformHost`
  (`kind`/`capabilities`/`preferences`), a `PlatformCapabilities` flags struct
  (mirroring `RendererCapabilities` — `preferences` today, `filesystem`/`dialogs`
  reserved), a `PreferenceStore` (async string key/value), the browser-safe
  `BrowserPlatformHost` (localStorage), and a dependency-free `isTauri()` runtime
  check (`'__TAURI_INTERNALS__' in globalThis`). The browser host ships in the
  package because it depends only on web APIs.
- **The Tauri host lives in `apps/studio`** (the only Tauri consumer) and is
  reached solely through a lazy dynamic `import()` gated on `isTauri()`, so a
  plain-browser bundle never pulls native bindings onto its boot path — which is
  what preserves browser testability. When a second native consumer appears
  (a standalone runtime / `editor-*` tool), the host is promoted to its own
  package, mirroring how `renderer-webgpu` is separate from `renderer-core`.
- **Preferences is the first capability, proven end-to-end.** The studio's dock
  layout, previously persisted inline via `localStorage`, now goes through
  `platform.preferences` under the same `retro.studio.layout` key (existing
  browser layouts survive). Native persistence is three app-local
  `#[tauri::command]`s (`pref_get`/`pref_set`/`pref_remove`) over one JSON file
  in the app config dir; app-local commands are allowed by default in Tauri 2.x,
  so only the scaffold's `core:default` capability is required.
- **Format split is deliberate.** The `PreferenceStore` is opaque machine state
  (e.g. the ImGui layout INI blob), persisted as JSON — consistent with the
  project/manifest/scene JSON formats and dependency-free on the Rust side.
  Human-editable structured editor/project settings (a TOML candidate) are a
  separate, deferred layer routed through reflectable resources, not stuffed into
  the opaque key/value store.
- **Filesystem will back the existing engine I/O seam, not a new one.** When the
  filesystem capability lands, the native host produces objects satisfying the
  engine's existing `AssetSource`/`AssetSink`; the browser side reuses the
  ADR-0070 fetch + dev-server-route pattern.

## Consequences

- The same studio frontend boots natively (Tauri) and in a plain browser, and the
  browser path stays fully Playwright-reachable because the Tauri host is never on
  its boot graph. A `platformKind` probe field plus a `__studioPrefs` hook make the
  preference round-trip assertable without pixels.
- New OS/editor capabilities slot in behind `PlatformCapabilities` flags with a
  browser fallback, the same discipline as renderer capability flags — no
  per-feature branching on host type.
- The async `PreferenceStore` interface forced one wrinkle: the overlay's
  `layout.restore` is synchronous, so the studio pre-awaits the saved layout
  during an async boot tail and returns it synchronously. Accepted as a small,
  contained cost; the editor-sdk overlay contract is unchanged.
- Deferred (tracked, not dropped): the filesystem + native-dialog capabilities;
  the human-readable structured-settings layer; promoting the Tauri host to its
  own package once a second native consumer exists.

## Implementation

- `packages/editor-platform/src/index.ts` — `PlatformHost`, `PlatformCapabilities`, `PreferenceStore`, `isTauri`, `BrowserPlatformHost`
- `packages/editor-platform/src/{capabilities,preference-store,platform-host,is-tauri,browser-platform-host}.ts` — the contract + browser host
- `apps/studio/src/platform/create-platform-host.ts` — `createPlatformHost` (the `isTauri()` gating factory)
- `apps/studio/src/platform/tauri-platform-host.ts` — `TauriPlatformHost` (only `@tauri-apps/api` importer, lazy-loaded)
- `apps/studio/src/main.ts` — host selection, pre-loaded layout persistence onto `platform.preferences`, `platformKind`/`__studioPrefs` probe
- `apps/studio/src-tauri/src/lib.rs` — `pref_get` / `pref_set` / `pref_remove` commands + `generate_handler!`
