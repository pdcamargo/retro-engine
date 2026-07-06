import type { Entity } from '@retro-engine/ecs';

/**
 * Emitted when a primary-button press begins on an {@link Interactable} node and
 * releases while the pointer is still over the same node (a completed click).
 * Read with `MessageReader(UiClicked)`.
 */
export class UiClicked {
  constructor(public readonly entity: Entity) {}
}
