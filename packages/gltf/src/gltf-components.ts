import type { Entity } from '@retro-engine/ecs';
import type { Handle } from '@retro-engine/engine';

import type { Gltf } from './gltf-root';

/**
 * Marks an entity to be populated from a {@link Gltf} asset. The instantiation
 * reactor waits for `handle` to resolve, then spawns the chosen scene's node
 * graph as a child subtree of this entity (so this entity's own `Transform`
 * positions the whole model). `scene` selects which scene to instantiate;
 * omitted, the asset's default scene is used.
 *
 * The reactor records the result as a {@link GltfInstanceNodes} on the same
 * entity and instantiates each root exactly once.
 */
export class GltfSceneRoot {
  readonly handle: Handle<Gltf>;
  readonly scene?: number;

  constructor(handle: Handle<Gltf>, scene?: number) {
    this.handle = handle;
    if (scene !== undefined) this.scene = scene;
  }
}

/**
 * The instantiated node graph of a {@link GltfSceneRoot}, recorded on the root
 * entity once its scene has been spawned. `nodeEntities` is indexed by glTF
 * node index — the canonical handle that scene node lists and future skin joints
 * reference; entries for nodes outside the instantiated scene are `undefined`.
 *
 * glTF node names are not unique, so name lookup is multi-valued: use
 * {@link findByName} for the first match in document order (the common
 * "attach a camera to the `eye` bone" case) or {@link findAllByName} for every
 * entity sharing a name. Unnamed nodes are reachable only by index.
 */
export class GltfInstanceNodes {
  /** Spawned entity per glTF node index; `undefined` for nodes not in the scene. */
  readonly nodeEntities: readonly (Entity | undefined)[];
  private readonly byNameMap: ReadonlyMap<string, readonly Entity[]>;
  /**
   * The asset index of the `GltfSceneRoot.handle` this subtree was built from,
   * and the scene index chosen. The re-instantiation system compares these to
   * the root's current handle/scene to detect a model swap.
   */
  readonly sourceIndex: number;
  readonly sourceScene?: number;

  constructor(
    nodeEntities: readonly (Entity | undefined)[],
    byNameMap: ReadonlyMap<string, readonly Entity[]>,
    sourceIndex: number,
    sourceScene?: number,
  ) {
    this.nodeEntities = nodeEntities;
    this.byNameMap = byNameMap;
    this.sourceIndex = sourceIndex;
    if (sourceScene !== undefined) this.sourceScene = sourceScene;
  }

  /** The first entity (in document order) spawned from a node named `name`. */
  findByName(name: string): Entity | undefined {
    return this.byNameMap.get(name)?.[0];
  }

  /** Every entity spawned from a node named `name`, in document order. */
  findAllByName(name: string): readonly Entity[] {
    return this.byNameMap.get(name) ?? [];
  }
}
