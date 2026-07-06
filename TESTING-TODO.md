# Testing TODO — morning review queue

Autonomous build-loop output. One line per finished item; a HOW-to-test note when
it isn't obvious. Items here were verified by unit tests + a build-green gate but
could **not** be exercised via the retro-studio MCP (no path exists), so they need
a manual confirmation before their backlog/roadmap entries are considered closed.

---

## Input system — Phase 1 (keyboard + mouse) · `@retro-engine/input` · ADR-0144

- **What changed:** New `@retro-engine/input` package: `ButtonInput<T>` / `Axis<T>`
  primitives; `KeyboardInput`, `MouseButtonInput`, `MouseMotion`, `MouseScroll`,
  `CursorPosition` resources; an `InputBackend` HAL (`DomInputBackend` +
  `HeadlessInputBackend`); `InputPlugin` (opt-in, headless-safe, `preUpdate`
  clear-then-drain lifecycle). Wired into the playground as `?mode=input`.
- **Automated:** 30 unit tests (button/axis/frame-lifecycle/backend-selection) green;
  lint/typecheck/test/build/bench all green. A per-frame bench (`applyInputFrame`)
  joined the suite (`packages/input/bench`, added to `bench:check`).
- **Why no MCP verification:** input needs real key/mouse events; the retro-studio
  MCP has no key-injection tool, and synthetic canvas events don't drive jsimgui.
  So this is unit-tested + manual.
- **HOW to test (manual):** run the playground (`cd apps/playground && bun run dev`),
  open `http://localhost:<port>/?mode=input`, click the canvas to focus it, then:
  - **WASD / arrow keys** move the white square; **release** stops it.
  - **Space** snaps it back to the origin.
  - **Hold left mouse button** → the square tints cyan; release → white.
  - **Mouse wheel** scales the square (0.4×–4×).
  - Live state is on `window.__input` (`{x, y, scale, pressed, cursor}`) — check it
    in the dev console to confirm resources update without eyeballing pixels.
- **Not deleted:** `docs/roadmap/input-system.md` stays (Phases 2–5 remain: action
  map + reflection, gamepad, touch, studio binding editor). `MASTER-ROADMAP.md`
  Input box left unchecked until the full AC (gamepad/touch/action-map) lands.

---

## Input system — Phase 2 (action map) · `@retro-engine/input` · ADR-0145

- **What changed:** Component-based action layer (leafwing-shaped). `ActionMap`
  (authored, reflection-registered, serialized) + `ActionState` (derived,
  auto-attached, not serialized). Fluent builder (`.button`/`.axis`/`.axis2d`) with
  `key()`/`mouseButton()` sources; per-frame resolver runs in `preUpdate` after the
  raw device update. Playground `?mode=input` now drives the sprite through the
  action map and rebinds `Reset` at runtime.
- **Automated:** +10 unit tests (builder, resolve semantics for button/axis/axis2d,
  many-to-many, reflection round-trip via `TypeRegistry`) — 40 input tests green;
  a `resolveActionState` bench joined the suite; full repo gate green.
- **Why no MCP verification:** same as Phase 1 — no key-injection path.
- **HOW to test (manual):** playground `?mode=input`, focus the canvas:
  - **WASD / arrow keys** move the square (via the `Move` / `MoveArrows` axis2d).
  - **Space** resets to origin (the `Reset` action). Press **R** to rebind Reset to
    **Enter** (then Enter resets, Space doesn't); press **R** again to swap back —
    `window.__input.resetKey` shows the current binding.
  - **F or left mouse** tints the square (the `Fire` action).
  - `window.__input` also exposes `{move:{x,y}, fire}` resolved from the action map.
- **Reflection check:** the `ActionMap` schema round-trips (unit test), so bindings
  will survive a scene save once the studio persists this component.

---
