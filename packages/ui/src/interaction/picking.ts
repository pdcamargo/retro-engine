import type { Entity } from '@retro-engine/ecs';
import type { CursorPosition, MouseButtonInput } from '@retro-engine/input';

import type { ComputedLayout } from '../ui-node';

import type { UiInteraction } from './ui-interaction';

/** One interactive node's absolute layout, for hit-testing. */
export interface PickEntry {
  readonly entity: Entity;
  readonly layout: ComputedLayout;
}

/**
 * Return the topmost interactive node whose border box contains the point
 * `(x, y)` (screen-space logical pixels), or `null`. "Topmost" is the greatest
 * {@link ComputedLayout.order} — the same depth-first order the renderer paints,
 * so the visually front-most node wins the pick.
 */
export const pickTopmost = (entries: readonly PickEntry[], x: number, y: number): Entity | null => {
  let best: Entity | null = null;
  let bestOrder = -Infinity;
  for (const { entity, layout } of entries) {
    if (x < layout.x || x > layout.x + layout.width) continue;
    if (y < layout.y || y > layout.y + layout.height) continue;
    if (layout.order >= bestOrder) {
      bestOrder = layout.order;
      best = entity;
    }
  }
  return best;
};

/**
 * Frame-persistent pointer bookkeeping for UI picking: the node currently under
 * the pointer (`hot`) and the node a press started on (`pressed`, held until
 * release). Render-world-free; a main-world resource inserted by
 * `UiInteractionPlugin`.
 */
export class UiPointer {
  hot: Entity | null = null;
  pressed: Entity | null = null;
}

/** One interactive node's entity, layout, and mutable interaction state. */
export interface InteractionNode {
  readonly entity: Entity;
  readonly layout: ComputedLayout;
  readonly ui: UiInteraction;
}

/**
 * Resolve one frame of UI pointer interaction: update each node's
 * {@link UiInteraction} state, track the pressed node across frames in
 * {@link UiPointer}, and fire `onClick` when a press releases over the node it
 * began on. `onChanged` is called for each node whose state changed (for change
 * detection). Pure but for the two callbacks — unit-testable without an ECS.
 *
 * - `'pressed'`: the pressed-origin node while the primary button is held.
 * - `'hovered'`: the node under the pointer (that is not the held press origin).
 * - `'none'`: everything else, or all nodes when the cursor has left the target.
 */
export const updateUiInteraction = (
  nodes: readonly InteractionNode[],
  cursor: CursorPosition,
  buttons: MouseButtonInput,
  pointer: UiPointer,
  onClick: (entity: Entity) => void,
  onChanged: (entity: Entity) => void,
): void => {
  const hot = cursor.present ? pickTopmost(nodes, cursor.x, cursor.y) : null;
  pointer.hot = hot;
  if (buttons.justPressed('Left') && hot !== null) pointer.pressed = hot;
  const leftDown = buttons.pressed('Left');

  for (const { entity, ui } of nodes) {
    const next =
      pointer.pressed === entity && leftDown ? 'pressed' : hot === entity ? 'hovered' : 'none';
    if (ui.state !== next) {
      ui.state = next;
      onChanged(entity);
    }
  }

  if (buttons.justReleased('Left')) {
    if (pointer.pressed !== null && pointer.pressed === hot) onClick(pointer.pressed);
    pointer.pressed = null;
  }
};
