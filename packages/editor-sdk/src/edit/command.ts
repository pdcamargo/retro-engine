import type { Entity, World } from '@retro-engine/ecs';

import type { FieldPath } from './field-path';
import type { EditScope } from './scope';

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

/**
 * Set one nested value on a component or asset, capturing the prior value for
 * undo. The {@link EditScope} decides whether the applier writes to the live
 * world (an entity component) or to an asset store (a stored value).
 */
export interface SetFieldCommand {
  readonly kind: 'setField';
  /** Whether this targets an entity component or a stored asset value. */
  readonly scope: EditScope;
  readonly path: FieldPath;
  /** Canonical key of {@link path}; the coalescing identity within an interaction. */
  readonly pathKey: string;
  /** Deep-cloned value before the edit. Never aliases live storage. */
  readonly before: unknown;
  /** Deep-cloned value after the edit. Never aliases live storage. */
  readonly after: unknown;
  /** A short human label for the action, shown in undo history / tooltips. */
  readonly label: string;
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

/** One component of an {@link AddBundleCommand}: its stable reflection name and the instance to insert. */
export interface BundleComponentEntry {
  /** Stable reflection name; the applier resolves the constructor from this. */
  readonly name: string;
  /** Deep-cloned instance to insert (cloned again on each apply so storage never aliases). */
  readonly instance: object;
}

/**
 * Attach a whole bundle's components to an entity in one undoable step; undo
 * removes them. Unlike a sequence of {@link AddComponentCommand}s, the insert is
 * a single archetype transition and a single timeline entry.
 */
export interface AddBundleCommand {
  readonly kind: 'addBundle';
  /** The entity the bundle is stamped onto. Re-validated at apply time. */
  readonly entity: Entity;
  /** A short human label for the action, shown in undo history / tooltips. */
  readonly label: string;
  /** The bundle's stable name, for display. */
  readonly bundleName: string;
  /** The components to insert, in order. */
  readonly components: readonly BundleComponentEntry[];
}

/**
 * One undoable editor action, as a plain data descriptor (custom actions aside).
 * A central applier interprets it against the live world, so the
 * world-mutation contract lives in exactly one place and the action stays
 * inspectable and replayable.
 */
export type EditCommand =
  | SetFieldCommand
  | AddComponentCommand
  | RemoveComponentCommand
  | AddBundleCommand
  | CustomCommand;
