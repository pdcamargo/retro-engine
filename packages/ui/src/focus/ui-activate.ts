import type { Entity } from '@retro-engine/ecs';

/**
 * A request to activate the currently-focused UI node — the keyboard/gamepad
 * equivalent of clicking it. Emit it from game input (Enter / Space / a gamepad
 * South button) with `MessageWriter(UiActivate)`; the focus layer turns it into a
 * `UiClicked` on `UiFocus.current`, so buttons, toggles, and anything else that
 * reacts to a click respond identically to pointer and non-pointer input.
 */
export class UiActivate {}

/**
 * The entity a pending activation should "click": the focused node when there is
 * an activation this frame and something is focused, else `null`. Pure — the
 * activation system's only logic, unit-tested.
 *
 * @internal
 */
export const shouldActivateFocused = (activated: boolean, focused: Entity | null): Entity | null =>
  activated && focused !== null ? focused : null;
