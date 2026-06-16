# Host-backed SceneSource providers (browser endpoint + Tauri file)

- **Created:** 2026-06-16

## Context

ADR-0080 introduced `SceneSource { load(): Promise<SceneData> }` as the studio's
opinionated, host-agnostic entry point for obtaining a scene, with a single
`inMemorySceneSource` implementation. The async signature exists precisely so
host-backed sources can drop in behind the same contract:

- **Browser:** fetch a `.scene` JSON from a dev endpoint (the `dev-server.ts`
  Bun server, extended with a route — mirroring its existing `/fonts` route and
  ADR-0070's fetch + dev-server pattern).
- **Tauri:** read a `.scene` file from disk via the native filesystem capability.

## Why deferred

The in-memory provider unblocks the editor's hierarchy + inspector without any
host I/O. The Tauri side depends on the filesystem capability reserved but not yet
built in ADR-0078 (`docs/backlog/platform-filesystem-dialog-capabilities.md`);
pulling it in now would add a native command + a Tauri rebuild to an
editor-introspection slice.

## Acceptance

- A browser `SceneSource` loads a `.scene` from a dev-server route, and a Tauri
  `SceneSource` loads a `.scene` from disk via the platform filesystem capability.
- The studio selects the provider the same way it selects the platform host
  (`isTauri()` gate / capability flag), with the in-memory provider as the
  fallback. The hierarchy/inspector are unchanged — they still consume whatever
  `SceneData` the source yields.
