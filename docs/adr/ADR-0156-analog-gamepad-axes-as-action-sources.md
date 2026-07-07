# ADR-0156: Analog gamepad axes as action sources

- **Status:** Accepted
- **Date:** 2026-07-06
- **Supersedes:** none (extends ADR-0145, ADR-0146 — both sealed, both name this as a follow-up)

## Context

ADR-0145 built the action map around **composite axes from digital buttons**:
an `axis` value is `(positiveX held ? 1 : 0) − (negativeX held ? 1 : 0)`, and an
`axis2d` is the same per component. That is exactly right for WASD / D-pad style
movement, but it cannot express a **real analog stick** — a left stick pushed
halfway should read `0.5`, not snap to `0` or `1`.

ADR-0146 shipped the poll-based gamepad source: `GamepadState` already exposes a
dead-zoned `Axis<GamepadAxis>` (`LeftStickX/Y`, `RightStickX/Y`, and the two
triggers as `[0,1]`), with stick Y negated so up is `+1`. Both ADRs explicitly
deferred *binding those continuous axes into the action map* to a follow-up. The
digital gamepad **buttons** already bind (ADR-0146 follow-up, `gamepadButton()`
source + `'gamepad'` device); what remains is the analog path.

The open questions this ADR settles:

1. How does an analog source differ from a digital one in the binding model?
2. What happens when an action carries **both** a keyboard leg and an analog stick
   (the common "WASD *or* left stick both move the player")?
3. How does the analog value reach the resolver?

## Decision

Analog axes bind through **two new binding roles**, resolved by reading the
gamepad's continuous `Axis<GamepadAxis>` rather than a digital pressed check.

- **New roles `'analogX'` / `'analogY'`** on `ActionBinding`, alongside the
  existing `trigger` / `positiveX` / `negativeX` / `positiveY` / `negativeY`. An
  `analogX` binding feeds the X of an `axis` or `axis2d`; `analogY` feeds the Y of
  an `axis2d`. Unlike the `positive*` / `negative*` legs (each a discrete ±1), an
  analog role carries the full `[-1, 1]` reading of one gamepad axis.

- **`gamepadAxis(axis: GamepadAxis): ActionSource`** — the source helper. Its
  shape is identical to `gamepadButton()` (`{ device: 'gamepad', code }`); the
  **binding role**, not the source, decides digital-vs-analog. A source is only
  ever analog because a builder method placed it in an `analogX` / `analogY` role.

- **Builder surface** — additive, no breakage:
  - `.axis(name, { negative, positive, analog? })` and
    `.axis2d(name, { left, right, up, down, analog?: { x, y } })` gain an optional
    `analog` field. The digital legs stay required, so the common keyboard case is
    unchanged; `analog` layers a stick on top of the same action.
  - `.stick(name, source)` and `.stick2d(name, { x, y })` — pure-analog
    conveniences that define an `axis` / `axis2d` with only analog bindings.

- **Combine rule — max magnitude.** When an action carries digital legs *and*
  analog bindings, the resolver computes the digital value (`pos − neg`) and the
  analog value (the largest-magnitude reading among that role's analog bindings),
  then keeps **whichever has the larger absolute value**, clamped to `[-1, 1]`.
  Keyboard-fully-pressed (`±1`) and a partial stick therefore coexist: pressing D
  reads `1`, letting go and pushing the stick to `0.4` reads `0.4`, and doing both
  keeps the dominant input. This mirrors leafwing's "the strongest input wins" and
  avoids the surprise of summing a held key with a resting-but-noisy stick.

- **`ActionInputs.gamepadAxes: AxisQuery<GamepadAxis>`** — the resolver reads
  continuous axis values through a new structural query
  (`{ value(axis): number }`), parallel to the existing digital `ButtonQuery`
  bundle. `InputPlugin` builds it from the first connected pad's dead-zoned
  `axes`, exactly as it already builds the digital `gamepad` query.

- **Reflection.** `ActionBinding.role`'s enum extends to include `analogX` /
  `analogY`; the `device` enum extends to include `'gamepad'` (a latent gap —
  ADR-0146's `gamepadButton()` bindings already produced `device: 'gamepad'` but
  the schema only enumerated `key` / `mouse`, so a saved scene with a gamepad
  binding would have failed enum validation). Both stay serialized (§13) — bindings
  are authored state.

## Consequences

- A stick-driven character is now one `.stick2d('Move', { x: gamepadAxis('LeftStickX'), y: gamepadAxis('LeftStickY') })`,
  and WASD-or-stick is the same action with both `analog` and the four digital legs.
- The max-magnitude combine keeps a single named action responsive to whichever
  device the player reaches for, with no per-frame mode switch and no double-count.
- No new state machinery: the analog value comes straight from the dead-zoned
  `Axis<GamepadAxis>` ADR-0146 already maintains; the action layer just reads it.
- Adding `gamepadAxes` to `ActionInputs` is a **signature change** on the exported
  `resolveActionState` (and every constructed `ActionInputs`), but the field is
  additive and callers inside the engine (the plugin) are updated in the same slice.
- Triggers (`LeftTrigger` / `RightTrigger`) are `[0, 1]` axes and bind through the
  same analog path; a one-sided `.stick('Throttle', gamepadAxis('RightTrigger'))`
  reads `0..1`. They also remain available as digital buttons.

## Implementation

- `packages/input/src/action-types.ts` — `'analogX'` / `'analogY'` in
  `BindingRole`; `gamepadAxis()` source; `analog` option on `.axis` / `.axis2d`;
  `.stick()` / `.stick2d()` builders.
- `packages/input/src/action-resolve.ts` — `AxisQuery`, `gamepadAxes` on
  `ActionInputs`, analog read + max-magnitude combine in the `axis` / `axis2d` arms.
- `packages/input/src/input-plugin.ts` — builds the `gamepadAxes` query from the
  first pad; extends the `ActionBinding` reflection enums (`role`, `device`).
