# Human-readable editor/project settings layer

- **Created:** 2026-06-16

## Context

ADR-0078's `PreferenceStore` is an opaque key/value store for small,
machine-managed editor state (window layout INI, last selection, simple flags),
persisted as JSON. It is intentionally *not* the place for structured settings a
user might want to open and hand-edit — theme, font size, autosave interval, snap
step, default units, and similar project/editor configuration. The studio already
models several of these in `apps/studio/src/state.ts` and the project-settings
dialog, but nothing persists them in an editable form yet.

## Why deferred

The first platform slice proved the seam with one opaque capability. A
human-editable settings layer is a different concern (structured, schema'd,
comment-friendly, format-stable) and pulls in a format decision worth its own ADR.

## Scope when picked up

- A structured settings layer distinct from the opaque `PreferenceStore`, routed
  through reflectable resources (ADR-0069) rather than raw key/value strings, so
  settings round-trip with schema/versioning instead of stringly-typed blobs.
- A human-readable on-disk format — **TOML is the leading candidate** (Rust/Tauri-
  native, comments, typed, no YAML whitespace footguns). Introducing a new on-disk
  format is an ADR-worthy decision; record it when this is picked up.
- Browser fallback consistent with the host model (the structured doc still needs a
  web persistence path; likely the ADR-0070 dev-server route, since `localStorage`
  is not user-editable).

## Acceptance

- Editor/project settings persist to a documented human-editable file, load back
  faithfully through reflection, and round-trip through both hosts — clearly
  separated from the opaque `PreferenceStore`.
