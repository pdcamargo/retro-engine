import { ComputedLayout, UiNode } from '../ui-node';

/** Pointer-interaction state of a UI node this frame. */
export type UiInteractionState = 'none' | 'hovered' | 'pressed';

/**
 * The current pointer-interaction state of an {@link Interactable} node, updated
 * each frame by the picking system. Derived/runtime state (recomputed from the
 * pointer + layout every frame), therefore **not serialized** — a game reads it
 * to drive visuals or logic, e.g. tint a button on `'hovered'`/`'pressed'`.
 */
export class UiInteraction {
  constructor(public state: UiInteractionState = 'none') {}
}

/**
 * Marks a UI node as pointer-interactive: the picking system hit-tests it,
 * maintains its {@link UiInteraction} state, and emits a `UiClicked` when a press
 * begins and releases on it. Authored (a node opts in); adding it auto-attaches a
 * {@link UiNode} and a {@link UiInteraction}.
 */
export class Interactable {
  static readonly requires = [UiNode, ComputedLayout, UiInteraction];
}
