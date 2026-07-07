import type { Entity } from '@retro-engine/ecs';

import { UiNode } from '../ui-node';

import type { NavDirection } from './focus-nav';

/**
 * Which UI node currently has keyboard/gamepad focus, read via `Res(UiFocus)`.
 * Runtime state (a single-focus pointer into the tree), so **not serialized**.
 * `null` when nothing is focused. Widgets read it to draw a focus ring or route
 * activation to the focused node.
 */
export class UiFocus {
  constructor(public current: Entity | null = null) {}
}

/**
 * Marks a UI node as able to receive focus. Directional / sequential
 * {@link UiNavigate} moves pick among `Focusable` nodes. Authored marker,
 * reflection-registered; adding it auto-attaches a {@link UiNode} (and thus a
 * `ComputedLayout`, which spatial navigation needs).
 */
export class Focusable {
  static readonly requires = [UiNode];
}

/**
 * A request to move UI focus, read by the focus system. Emit it from game input
 * (map arrow keys / Tab / a gamepad d-pad or stick to a direction) with
 * `MessageWriter(UiNavigate)`; the focus layer stays input-device-agnostic.
 *
 * `'next'` / `'prev'` are sequential (tab order); `'up'`/`'down'`/`'left'`/
 * `'right'` are spatial (nearest neighbour in that direction).
 */
export class UiNavigate {
  constructor(public readonly direction: NavDirection) {}
}
