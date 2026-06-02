import type { SerializedValue } from '@retro-engine/reflect';

/** A serialized component: a reflected {@link SerializedValue} attached to an entity. */
export type SerializedComponent = SerializedValue;

/** One entity in a {@link SceneData}: its compact in-scene id and serialized components. */
export interface SerializedEntity {
  /** Stable id within the scene; entity-typed fields reference entities by this id. */
  readonly id: number;
  readonly components: readonly SerializedComponent[];
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
}

/** Current scene wire-format version. */
export const SCENE_FORMAT_VERSION = 1;
