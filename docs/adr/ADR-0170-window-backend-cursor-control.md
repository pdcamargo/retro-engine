# ADR-0170: Window write-back HAL + cursor control

- **Status:** Accepted
- **Date:** 2026-07-07

## Context

`WindowPlugin` shipped the **read** side of windowing: it mirrors the surface's
size/dpr into a `Window` resource each frame. But a game also needs to **write**
window state — hide the hardware cursor (custom in-game cursor) and, above all,
capture the pointer for FPS / free-look mouselook (Pointer Lock). Doing that from
gameplay code by reaching for `element.requestPointerLock()` would bake the DOM
into engine/game systems and break headless runs (tests, server worlds).

The engine already solves this shape twice — `InputBackend` and `AudioBackend`
are HAL seams with a DOM/Web implementation and a headless no-op, chosen by their
plugin. Window write-back is the same pattern.

## Decision

A **`WindowBackend`** HAL for writing host window state, plus a `CursorOptions`
resource that game code drives.

- **`WindowBackend.applyCursor(visible, grab)`** is the seam. `DomWindowBackend`
  toggles the target element's CSS `cursor` and drives the Pointer Lock API;
  `HeadlessWindowBackend` no-ops. `WindowPlugin` picks the backend: a
  `DomWindowBackend` when a `cursorTarget` element is supplied (the game canvas,
  passed by the host exactly as `InputPlugin` takes `pointerTarget`), else
  headless — so cursor control is inert until a target exists.
- **`CursorOptions` resource** (`visible`, `grab: 'none' | 'locked'`) is the
  game-facing API, read/written via `Res`/`ResMut`. Runtime state (a live
  setting), **not serialized**. Web supports only free vs. locked, so `grab` is a
  two-value union today; a `'confined'` desktop mode is a later addition.
- **`reconcileCursor(desired, applied, backend)`** applies to the backend only
  when the desired state differs from the last-applied snapshot, so a steady
  setting costs one comparison, not a DOM call every frame. Pure over its inputs
  (backend injected) → unit-tested with a mock backend. `WindowPlugin` runs it in
  `last`, after gameplay has settled `CursorOptions`.
- **Pointer lock is gesture-gated by the browser.** `requestPointerLock` only
  succeeds during a user gesture, and the browser may exit lock on its own (Esc).
  The engine issues the request/exit on change and leaves that reality to game
  code (set `grab: 'locked'` from a click); it does not try to fight the browser.

## Consequences

- Mouselook becomes possible without any DOM in game systems: set
  `CursorOptions.grab = 'locked'` (from a click), read `MouseMotion` deltas.
- Headless and target-less runs are unaffected — the backend no-ops, no resource
  behavior changes.
- The `WindowBackend` seam is the home for future window write-back (fullscreen,
  present-mode/vsync, title, position), keeping the DOM out of engine code.
- The actual pointer-lock/cursor effect is browser-verified; the engine-side
  reconcile + backend selection are unit-covered (mock backend), matching how the
  input/audio DOM backends ship.

## Implementation

- `packages/engine/src/cursor.ts` — `CursorOptions`, `CursorGrab`, `WindowBackend`, `HeadlessWindowBackend`, `DomWindowBackend`, pure `reconcileCursor`.
- `packages/engine/src/window.ts` — `WindowPlugin` backend selection + the `cursor-apply` system; `WindowPluginOptions`.
- `packages/engine/src/index.ts` — public exports.
