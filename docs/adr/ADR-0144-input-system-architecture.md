# ADR-0144: Input system architecture

- **Status:** Accepted
- **Date:** 2026-07-06

## Context

The engine has no game-facing input. Gameplay code cannot read the keyboard,
mouse, gamepad, or touch; the only DOM listeners today are the studio's own
viewport-camera controls, wired directly to the canvas. To ship a game we need a
platform-agnostic input layer with the same API in the browser and inside the
Tauri webview, consumable from ECS systems — no `addEventListener` in game code.

Constraints and prior art:

- **Bevy's model** is the reference: per-frame resources `ButtonInput<T>` (with
  `pressed` / `just_pressed` / `just_released`) and `Axis<T>` for analog values,
  fed by platform events converted in a `PreUpdate` pipeline, plus an
  action-mapping layer on top (`leafwing-input-manager` in the ecosystem).
- **The App already exposes the seams we need:** a `preUpdate` stage that runs
  after the engine `Time` tick and before `update`; resources keyed by
  constructor read through `Res` / `ResMut`; a headless mode (no canvas) used by
  tests and server worlds.
- **Resources are keyed by constructor**, so a single generic `ButtonInput<T>`
  instance cannot represent both keyboard and mouse buttons at once — each device
  needs a distinct concrete class.
- **The webview has no privileged input.** All input is DOM-scoped
  (`KeyboardEvent`, `PointerEvent`/`MouseEvent`, `WheelEvent`, the Gamepad API,
  `TouchEvent`). There is no OS-global capture, and none is wanted for game input.
- **Physical vs logical keys.** Games bind to *physical* key positions (WASD
  stays WASD on AZERTY), which is exactly `KeyboardEvent.code`, not `.key`.

## Decision

Input ships as a new **`packages/input`** package (`@retro-engine/input`),
layered on top of `@retro-engine/engine` (it registers a plugin, so it depends on
`engine`; `engine` never depends on it). It is composed of four concerns:

1. **Primitives (engine-independent).** A generic `ButtonInput<T>` holding three
   sets — `pressed`, `justPressed`, `justReleased` — with `press` / `release` /
   `clear` (drops only the two transient sets) / `reset*` and the Bevy-shaped
   query methods (`pressed`, `justPressed`, `justReleased`, `anyPressed`,
   `allPressed`, getters). A generic `Axis<T>` mapping a key to a clamped analog
   value. These import nothing from the engine and are independently testable.

2. **ECS resource surface.** Distinct concrete resources, one per device channel,
   so the constructor-keyed resource map can hold them side by side:
   `KeyboardInput extends ButtonInput<KeyCode>`,
   `MouseButtonInput extends ButtonInput<MouseButton>`, plus per-frame
   accumulators `MouseMotion` (relative delta), `MouseScroll` (wheel delta +
   unit), and `CursorPosition` (target-local pixels + `present`). `KeyCode` is a
   string union of `KeyboardEvent.code` values (physical keys); `MouseButton` is
   `'Left' | 'Right' | 'Middle' | 'Back' | 'Forward'`. Systems read via
   `Res(KeyboardInput)` etc.

3. **Backend abstraction.** An `InputBackend` interface —
   `attach()` / `detach()` / `drain(): readonly RawInputEvent[]` — decouples event
   capture from state. `RawInputEvent` is a normalized union (`key-down`/`up`,
   `mouse-down`/`up`, `mouse-move`, `wheel`, `blur`). `DomInputBackend` attaches
   DOM listeners (keyboard/mouse/wheel/blur on `window`, cursor coords mapped
   against an optional pointer target) and queues normalized events; `attach()`
   is idempotent. `HeadlessInputBackend` is a no-op returning no events. This is
   the same HAL shape the renderer uses (contract + swappable concrete backend),
   so a future Tauri or test backend conforms without touching the plugin.

4. **`InputPlugin`.** Inserts the resources, holds the backend (defaulting to
   `DomInputBackend` when `typeof window !== 'undefined'`, else headless), and
   registers **one `preUpdate` system** that each frame, in order: (a) `clear()`s
   the button inputs and zeroes the accumulators — dropping *last* frame's
   just-pressed/just-released — then (b) drains the backend and applies events, so
   this frame's transitions are visible through `update` / `postUpdate` / `last`
   and are cleared at the start of the next frame. A `blur` event releases all
   held buttons (marking them just-released) so focus loss can't strand a key
   "down."

**Not serialized (§13).** Every Phase-1 input resource is transient device state
recomputed from events every frame — the "deliberately not serialized" category.
None is registered with the type registry. The **action map** (a later phase) is
authored configuration (actions → physical inputs) and *is* serialized with a
reflection schema, registered by `InputPlugin`.

**No renderer capability flag** applies — input is platform, not GPU. Gamepad and
touch availability are runtime-probed at their phases, not build-time gated.

## Consequences

- Game code reads input through ECS resources with zero DOM knowledge, identical
  in browser and webview; tests and headless worlds get a no-op backend for free.
- The generic `ButtonInput<T>` / `Axis<T>` primitives are reused by every future
  device (gamepad buttons/axes, touch) and by the action map, so later phases add
  resources and a mapping layer, not new state machinery.
- Physical-key binding (`KeyboardEvent.code`) means bindings survive keyboard
  layouts, at the cost of `KeyCode` being a large hand-maintained union; unknown
  codes still flow through as strings (the backend does not gate on the union).
- One package boundary crossing to add: consumers (studio, playground, games) opt
  in by adding `InputPlugin` — it is not in `CorePlugin`, because attaching global
  DOM listeners is a host decision, not a framework default.
- DOM listeners live for the App/backend lifetime. Detaching on hot-reload of a
  *user* plugin that owns the backend is a tracked follow-up (idempotent
  `attach()` prevents duplicate-listener leaks in the meantime); hosts add
  `InputPlugin` at engine/editor level so it survives user hot-swaps.
- Later phases (gamepad polling, touch/gestures, action map, studio binding
  editor) extend this ADR's surface; a genuinely new architectural decision in
  one of them gets its own ADR.

## Implementation

- `packages/input/src/index.ts` — public re-exports.
- `packages/input/src/button-input.ts` — `ButtonInput<T>`.
- `packages/input/src/axis.ts` — `Axis<T>`.
- `packages/input/src/keyboard.ts` — `KeyCode`, `KeyboardInput`.
- `packages/input/src/mouse.ts` — `MouseButton`, `MouseButtonInput`, `MouseMotion`,
  `MouseScroll`, `CursorPosition`.
- `packages/input/src/raw-event.ts` — `RawInputEvent`, `InputBackend`.
- `packages/input/src/dom-backend.ts` — `DomInputBackend`, `HeadlessInputBackend`.
- `packages/input/src/input-plugin.ts` — `InputPlugin`.
