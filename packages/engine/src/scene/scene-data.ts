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

/**
 * A reference to a child scene instantiated *live* under an entity (scene
 * composition). Unlike a {@link SerializedTemplateRef}, which expands to
 * components at spawn and bakes into the parent on the next save, a scene ref is
 * a persistent link: the child stays an independent, editable asset addressed by
 * its GUID, and saving the parent re-emits this reference rather than the child's
 * expanded entities.
 *
 * The referencing ("mount") entity keeps its own components — its `Transform`
 * positions the instance, a `Name` labels it, a `Parent` nests it — and a single
 * despawn of it (or any ancestor) tears the whole child instance down. To include
 * the same child scene more than once, give several entities the same `guid`.
 */
export interface SerializedSceneRef {
  /** GUID of the child {@link import('./scene-asset').Scene} asset to instantiate under this entity. */
  readonly guid: string;
}

/**
 * A parent edge that crosses into a derived (instantiated) subtree, persisted as
 * a stable anchor instead of a raw entity id. An authored entity parented onto a
 * node that another entity rebuilds on load — e.g. a sword on a glTF model's
 * `hand.R` bone — cannot reference that node by id (it is excluded from the save
 * and would dangle). Instead the save records the mount it attaches into (`to`)
 * and a `kind`-tagged, opaque `anchor`; on load the entity gains a transient
 * `PendingAttachment`, and the matching `kind` system parents it under the
 * resolved node once the mount's subtree exists.
 */
export interface SerializedAttachment {
  /** In-scene id of the mount entity (e.g. the model root) this attaches into. */
  readonly to: number;
  /** Tag selecting the loader that resolves {@link anchor} (e.g. `'gltf-node'`). */
  readonly kind: string;
  /** Loader-defined locator for the parent within the mount's instantiated subtree. */
  readonly anchor: unknown;
}

/**
 * The recorded edits to one *derived* entity — a node another entity rebuilds on
 * load (e.g. an instantiated glTF node) — addressed by a stable, `kind`-tagged
 * anchor rather than by id (the entity is excluded from the save and re-created
 * fresh). On load, after the owning subtree re-instantiates, a matching resolver
 * finds the live entity and applies these deltas, so a user's edits to an
 * instanced model survive a save/reload without flattening the instance.
 *
 * The four delta kinds mirror a prefab-override model: `set` patches fields of a
 * component the source already produced (only the changed fields, so untouched
 * ones keep inheriting from the source); `add` inserts a whole component the
 * source did not have; `remove` deletes components by type name; `deleted` marks
 * the derived entity itself as removed.
 */
export interface SerializedDerivedOverride {
  /** Tag selecting the resolver that maps {@link anchor} to a live entity (e.g. `'gltf-node'`). */
  readonly kind: string;
  /** Resolver-defined locator for the derived entity within the mount's instantiated subtree. */
  readonly anchor: unknown;
  /** Field-level patches to components the source produced; only the changed fields are listed. */
  readonly set?: readonly SerializedOverride[];
  /** Whole components the source did not produce, inserted on load (so their required components resolve). */
  readonly add?: readonly SerializedComponent[];
  /** Type names of components present on the source node but removed by the user. */
  readonly remove?: readonly string[];
  /** The derived entity itself was deleted; on load it is despawned after re-instantiation. */
  readonly deleted?: boolean;
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
  /**
   * A child scene instantiated live under this entity (composition). On load the
   * entity gains a `SceneRoot` for the referenced child, which the instantiation
   * reactor expands and parents beneath it; on save it is re-emitted as the
   * reference, and the child's instantiated entities are excluded. Resolved by
   * GUID through the App's `AssetServer` (or a caller-injected resolver).
   */
  readonly scene?: SerializedSceneRef;
  /**
   * A parent edge into another entity's derived subtree, recorded as a stable
   * anchor rather than a raw `Parent` id (which would dangle, since the target
   * node is excluded from the save). Present instead of a `Parent` component when
   * the entity is parented onto an instantiated node; on load it becomes a
   * `PendingAttachment` that the owning subtree's `kind` system resolves.
   */
  readonly attach?: SerializedAttachment;
  /**
   * Edits to this entity's *derived* subtree (the instantiated nodes another
   * system rebuilds on load), each addressed by a stable anchor. Present on a
   * composition mount (e.g. a `GltfSceneRoot`) when the user has changed, added,
   * removed, or deleted any of its instantiated entities. Excluded derived
   * entities are still omitted as full entities; this records only the deltas,
   * re-applied once the subtree re-instantiates.
   */
  readonly derived?: readonly SerializedDerivedOverride[];
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
