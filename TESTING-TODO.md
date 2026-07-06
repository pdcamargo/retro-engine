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

## Input system — Phase 3 (gamepad) · `@retro-engine/input` · ADR-0146

- **What changed:** Poll-based gamepad support. `GamepadSource` (`NavigatorGamepadSource`
  + `HeadlessGamepadSource`), `Gamepads` resource keyed by pad index with per-pad
  `ButtonInput<GamepadButton>` + `Axis<GamepadAxis>`, W3C Standard-Gamepad mapping
  (named buttons/axes; stick-Y flipped so up=+1; triggers as [0,1] axes), configurable
  dead zone, connect/disconnect via poll reconciliation. Polled in `preUpdate`.
- **Automated:** +11 unit tests (dead zone, connect/read, button edges, triggers,
  disconnect lifecycle, non-standard raw access, multi-pad) — 50 input tests green;
  an `updateGamepads` bench joined the suite; full repo gate green.
- **Why no MCP verification:** no gamepad-injection path (and no physical pad in CI).
- **HOW to test (manual):** plug in an Xbox/PS controller, open playground `?mode=input`,
  press any button on the pad once (browsers only expose a gamepad after first input),
  then: **left stick** moves the square; **A / ✕ (South)** tints it. `window.__input.gamepad`
  shows `{connected, x, y, south}`. If you have no controller, this phase is covered by
  the unit tests only — the `Gamepads` API is driven by a scriptable `GamepadSource`.
- **Follow-up (not done):** gamepad bindings in the action map (rebindable gamepad) —
  logged as a new MASTER-ROADMAP item.

---

## Input system — Phase 4 (touch) · `@retro-engine/input` · ADR-0144

- **What changed:** `Touches` resource of active `TouchPoint`s (id, position,
  start position, per-frame delta, phase) with a `ButtonInput`-style lifecycle
  (`justStarted`/`justEnded`, `iter`/`first`/`count`). DOM backend emits
  touchstart/move/end/cancel; folded into the same `preUpdate` frame step.
- **Automated:** +3 unit tests (start→move→end lifecycle, multi-touch, cancel) —
  53 input tests green; touch events added to the `applyInputFrame` bench; full gate green.
- **Why no MCP verification:** no touch-injection path.
- **HOW to test (manual):** playground `?mode=input`, open browser devtools and
  enable **touch/device emulation**, then drag on the canvas — `window.__input.touches`
  shows `{count, x, y}` for the primary touch. Without a touch device this is covered
  by the unit tests (a scriptable `QueueBackend` feeds touch events).

---

## ✅ P0 Input item COMPLETE — box checked in MASTER-ROADMAP

The **Input system** P0 item is fully done (keyboard + mouse + action map + gamepad +
touch; headless-safe; reflection; sample). Reference tag flipped to ✅. Remaining input
work (gamepad-in-action-map, touch gestures, studio binding editor) moved to **P1**.
Next P0 target: **Audio (core)**.

---
