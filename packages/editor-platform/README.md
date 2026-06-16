# @retro-engine/editor-platform

Platform-host abstraction for the Retro Engine studio. It hides the difference
between running inside a native desktop shell and running in a plain browser
behind one interface — so editor code is written once and works in both.

## What's here

- **`PlatformHost`** — the services the studio runs against (`kind`,
  `capabilities`, `preferences`).
- **`PlatformCapabilities`** — flags for optional capabilities (`preferences`
  today; `filesystem` / `dialogs` reserved for native hosts). Editor code checks
  a flag and falls back when a capability is absent.
- **`PreferenceStore`** — a small async key/value store for editor state such as
  window layout.
- **`BrowserPlatformHost`** — the browser implementation, using only standard web
  APIs (`localStorage`). It is the default when no desktop shell is detected.
- **`isTauri()`** — a dependency-free runtime check used to pick the host.

## Hosts

The browser host ships here because it depends on nothing but the web platform.
The native (Tauri) host lives in the studio app, the only place that depends on
the desktop shell, and is selected at startup via `isTauri()` and injected — the
same way a renderer backend is.
