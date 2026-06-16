---
'@retro-engine/editor-platform': minor
---

feat(editor-platform): platform-host abstraction with a preferences capability

A new leaf package holding the `PlatformHost` seam that hides Tauri-vs-browser behind one interface, so studio code is written once and runs (and stays Playwright-testable) in both. Extends the app-layer dependency-injection pattern ADR-0070 set for I/O to OS/editor capabilities — the engine names only interfaces and never imports a platform API.

- `PlatformHost` (`kind` / `capabilities` / `preferences`) — the services the studio runs against.
- `PlatformCapabilities` — optional-capability flags (`preferences` today; `filesystem` / `dialogs` reserved), checked-and-fallback like renderer capabilities.
- `PreferenceStore` — a small async string key/value store for editor state such as window layout.
- `BrowserPlatformHost` — the browser implementation over `localStorage`; ships here because it depends only on web APIs.
- `isTauri()` — a dependency-free runtime check used to pick the host.

The native (Tauri) host lives in the studio app and is selected via `isTauri()` and injected at startup, the same way a renderer backend is. Filesystem/dialog capabilities and a human-readable structured-settings layer are deferred and tracked.
