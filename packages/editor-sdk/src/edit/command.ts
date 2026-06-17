import type { Entity, World } from '@retro-engine/ecs';

import type { FieldPath } from './field-path';

interface EditBase {
  /** The entity the edit targets. Re-validated (the entity may have despawned) at apply time. */
  readonly entity: Entity;
  /**
   * The stable reflection name of the component (never the class name, which is
   * minification-unsafe). The applier resolves the constructor from this.
   */
  readonly componentName: string;
  /** A short human label for the action, shown in undo history / tooltips. */
  readonly label: string;
}

/** Set one nested value on a component, capturing the prior value for undo. */
export interface SetFieldCommand extends EditBase {
  readonly kind: 'setField';
  readonly path: FieldPath;
  /** Canonical key of {@link path}; the coalescing identity within an interaction. */
  readonly pathKey: string;
  /** Deep-cloned value before the edit. Never aliases live storage. */
  readonly before: unknown;
  /** Deep-cloned value after the edit. Never aliases live storage. */
  readonly after: unknown;
}

/** Attach a component to an entity; undo removes it. */
export interface AddComponentCommand extends EditBase {
  readonly kind: 'addComponent';
  /** Deep-cloned instance to insert (cloned again on each apply so storage never aliases). */
  readonly after: object;
}

/** Detach a component from an entity; undo re-inserts it. */
export interface RemoveComponentCommand extends EditBase {
  readonly kind: 'removeComponent';
  /** Deep-cloned instance to restore on undo. */
  readonly before: object;
}

/** An edit whose apply/undo cannot be expressed as a field set or component swap. */
export interface CustomCommand extends EditBase {
  readonly kind: 'custom';
  apply(world: World): void;
  revert(world: World): void;
}

/**
 * One undoable editor action, as a plain data descriptor (custom actions aside).
 * A central applier interprets it against the live world, so the
 * world-mutation contract lives in exactly one place and the action stays
 * inspectable and replayable.
 */
export type EditCommand = SetFieldCommand | AddComponentCommand | RemoveComponentCommand | CustomCommand;
