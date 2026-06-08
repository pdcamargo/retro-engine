import type { SerializedValue } from '@retro-engine/reflect';

/** A serialized component: a reflected {@link SerializedValue} attached to an entity. */
export type SerializedComponent = SerializedValue;

/**
 * A field-level override applied on top of a template-produced component. Unlike
 * a {@link SerializedComponent} this is *partial* — only the fields it names are
 * overlaid onto the produced instance, and the rest keep the template's values.
 * It carries no schema `version`; its fields decode against the current schema.
 */
export interface SerializedOverride {
  /** Stable type name of the component being patched. */
  readonly type: string;
  /** The subset of fields to overlay, keyed by field name. */
  readonly data: Record<string, unknown>;
}

/**
 * A reference to a registered template, embedded in a scene so the loader expands
 * it at spawn time. `params` substitute into the template's recipe; optional
 * `overrides` then patch individual fields of the produced components for this
 * specific instance.
 */
export interface SerializedTemplateRef {
  /** Stable name of the registered template to expand. */
  readonly template: string;
  /** Parameter values for the template, keyed by param name. Omitted params use their defaults. */
  readonly params?: Record<string, unknown>;
  /** Per-instance field-level overrides applied on top of the produced components. */
  readonly overrides?: readonly SerializedOverride[];
}

/**
 * A binding of a registered observer handler to a scene entity. The scene names
 * the handler; the handler — registered in code via
 * `App.registerObserverHandler` — carries the event it observes and the body to
 * run. Behavior is referenced by name, never serialized.
 */
export interface SerializedObserverBinding {
  /** Stable name of the registered observer handler to attach to the entity. */
  readonly handler: string;
}

/** One entity in a {@link SceneData}: its compact in-scene id and serialized components. */
export interface SerializedEntity {
  /** Stable id within the scene; entity-typed fields reference entities by this id. */
  readonly id: number;
  readonly components: readonly SerializedComponent[];
  /**
   * Template references to expand into additional components for this entity.
   * Expanded before the explicit `components`, so an explicit component of the
   * same type overrides the template's output.
   */
  readonly templates?: readonly SerializedTemplateRef[];
  /**
   * Observer handlers to attach to this entity, by registered name. Each names a
   * handler registered via `App.registerObserverHandler`; the handler carries the
   * event it observes and the body to run. Attached after the entity's components
   * are inserted. Behavior is referenced by name, never serialized.
   */
  readonly observers?: readonly SerializedObserverBinding[];
}

/**
 * A serialized world or curated entity subset. Entities carry compact ids
 * (`0..N`) rather than live entity ids so a scene is portable across worlds; the
 * loader remaps them to freshly-spawned entities.
 */
export interface SceneData {
  /** Wire-format version of the scene envelope (not of any component). */
  readonly version: number;
  readonly entities: readonly SerializedEntity[];
  /**
   * Registered App resources captured with the scene, each a reflected
   * {@link SerializedValue}. Optional and additive: a scene authored without
   * resources omits the key, so existing scenes round-trip byte-identically and
   * the envelope version is unchanged. Restored on load by `spawnScene` (a
   * resource carries no entity identity, so it lives here rather than on an
   * entity); entity- and handle-typed resource fields remap/resolve through the
   * same env the entities use.
   */
  readonly resources?: readonly SerializedValue[];
}

/** Current scene wire-format version. */
export const SCENE_FORMAT_VERSION = 1;
