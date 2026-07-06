---
'@retro-engine/input': minor
---

feat(input): Phase 1 — keyboard + mouse input package (`@retro-engine/input`)

Per ADR-0144, a new platform-agnostic input package layered on `@retro-engine/engine`, with the same API in the browser and inside the Tauri webview. Add `InputPlugin` to an `App` and read input through ECS resources — no DOM listeners in game code. Headless-safe: with no `window` present the plugin installs a no-op backend, so tests and server worlds run unchanged.

**New public surface:**

- `ButtonInput<T>` — generic per-frame button state with `pressed` / `justPressed` / `justReleased` (+ `anyPressed` / `allPressed` / getters / `press` / `release` / `releaseAll` / `clear` / `reset*`). Mirrors Bevy's `ButtonInput<T>`.
- `Axis<T>` — generic clamped analog values (default range `[-1, 1]`).
- `KeyboardInput extends ButtonInput<KeyCode>` — keyboard state keyed by physical `KeyCode` (`KeyboardEvent.code`, so WASD stays WASD across layouts).
- `MouseButtonInput extends ButtonInput<MouseButton>`, plus per-frame `MouseMotion` (delta), `MouseScroll` (wheel delta + unit), and `CursorPosition` (target-local pixels + `present`).
- `InputBackend` interface (`attach` / `detach` / `drain`) with `DomInputBackend` (window + pointer-target listeners, idempotent attach) and `HeadlessInputBackend` (no-op).
- `InputPlugin` — inserts the resources and runs the once-per-frame `preUpdate` clear-then-drain that keeps `justPressed` / `justReleased` scoped to the current frame; focus loss releases held buttons. Not in `CorePlugin` — hosts opt in.
- `applyInputFrame`, `mouseButtonFromIndex` helpers.

All input state is transient (recomputed each frame) and deliberately unregistered for serialization; the authored action map arrives in Phase 2 with a reflection schema.
