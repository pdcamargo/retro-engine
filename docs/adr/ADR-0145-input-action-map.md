# ADR-0145: Input action map (component-based, per-entity)

- **Status:** Accepted
- **Date:** 2026-07-06

## Context

ADR-0144 shipped raw device input (`KeyboardInput` / `MouseButtonInput` and the
mouse accumulators). Game code that reads physical keys directly (`keys.pressed('KeyW')`)
hard-codes the binding: it cannot be rebound at runtime, cannot serialize into a
scene, and re-implements the same "WASD → movement vector" glue in every project.
Bevy solves this with `leafwing-input-manager`: an `InputMap<A>` maps named actions
to inputs, an `ActionState<A>` holds the resolved per-action state, and both are
**components on the player entity** (`ActionState` is a required component of
`InputMap`). `VirtualDPad` / `VirtualAxis` synthesize continuous axis values from
discrete buttons.

Retro Engine needs the equivalent, and it must:

- **Serialize** — the binding configuration is authored state a scene should
  round-trip (§13); it therefore needs a reflection schema.
- **Fit the reflection primitives** — `t` offers `string` / `enum` / nested `type`
  / `array`, but no map/dictionary kind, so the authored shape must be arrays of
  registered value types, not a keyed record.
- **Support local multiplayer eventually** — two players each need their own
  bindings and resolved state.

## Decision

The action map is **component-based, mirroring leafwing**:

- **`ActionMap`** — an authored component (reflection schema, serialized) holding
  `defs: ActionDef[]`. It declares `static requires = [ActionState]`, so spawning
  an entity with an `ActionMap` auto-attaches its resolved state (Required
  Components, same mechanism as `Transform → GlobalTransform`).
- **`ActionState`** — a **derived** component (recomputed every frame, **not**
  registered / not serialized — the §13 "deliberately not serialized" category).
  Exposes `pressed` / `justPressed` / `justReleased` / `value` / `axis` / `axis2d`
  per action name.
- **Serializable value types**, registered via `registerType`:
  - `ActionBinding` — one physical source: `{ device: 'key' | 'mouse', code: string,
    role: BindingRole }`. `role` is `'trigger'` (button), or `'positiveX'` /
    `'negativeX'` / `'positiveY'` / `'negativeY'` for the composite-axis legs.
  - `ActionDef` — `{ name: string, kind: 'button' | 'axis' | 'axis2d',
    bindings: ActionBinding[] }`.
- **Composite axes from buttons** (the `VirtualAxis` / `VirtualDPad` model):
  `axis` value = `(positiveX held ? 1 : 0) − (negativeX held ? 1 : 0)`; `axis2d`
  is the same per component into an `{ x, y }` (raw — diagonals are not normalized;
  callers normalize if they want unit-speed diagonals). Real analog gamepad axes
  arrive in Phase 3 as an additional binding device.
- **Resolution** runs in `preUpdate` immediately after the ADR-0144 `input-update`
  system (`after: ['input']`), querying `(ActionMap, ActionState)` and reading
  `KeyboardInput` / `MouseButtonInput`. Edge state (`justPressed`/`justReleased`)
  is computed by `ActionState` itself from its own previous-frame snapshot, so it
  is correct for many-to-many bindings (an action stays "held" while *any* bound
  input is held). A fluent builder (`.button()` / `.axis()` / `.axis2d()` with
  `key()` / `mouseButton()` source helpers) constructs `defs` ergonomically.
- **Registration** is done by `InputPlugin.build()` — the resolution system and
  the `ActionMap` / `ActionDef` / `ActionBinding` schemas.

A global single-player game simply spawns one entity carrying an `ActionMap`.

## Consequences

- Bindings serialize with the scene and rebind at runtime by mutating `ActionMap.defs`;
  gameplay reads `ActionState` by name and is decoupled from physical keys.
- Per-entity maps give local multiplayer for free (one `ActionMap` per player) and
  match the engine's component + Required-Components + reflection model with no new
  machinery.
- The array-of-value-types shape (no dictionary) is slightly more verbose than a
  keyed record but is exactly what the reflection codec round-trips today; the
  builder API hides the verbosity at authoring time.
- Composite axes are raw button sums; unit-normalized diagonals and true analog
  values are deferred to Phase 3 (gamepad), which adds a binding device rather than
  reworking this surface.
- `ActionState` being derived means a code hot reload (ADR-0102) drops and
  recomputes it — correct, since it is never authored.

## Implementation

- `packages/input/src/action-types.ts` — `InputDevice`, `BindingRole`, `ActionKind`,
  `ActionBinding`, `ActionDef`, `ActionMap`, `key`, `mouseButton`.
- `packages/input/src/action-state.ts` — `ActionState`.
- `packages/input/src/action-resolve.ts` — `resolveActionState`.
- `packages/input/src/input-plugin.ts` — `InputPlugin.build` registers the schemas
  and the `action-update` system.
