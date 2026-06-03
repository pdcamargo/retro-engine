import type { Entity } from '@retro-engine/ecs';
import type { Handle } from '@retro-engine/assets';

import type { Scene } from './scene-asset';
import type { SpawnSceneOptions } from './spawn';

/**
 * Marks an entity as the root of a {@link Scene} instance. The instantiation
 * reactor waits for `handle` to resolve in the `Scenes` store, then spawns the
 * scene's entity graph and re-parents its top-level entities under this entity —
 * so this entity's own `Transform` positions the whole instance and despawning it
 * tears the instance down. Spawned exactly once; the result is recorded as a
 * {@link SceneInstance} on the same entity.
 *
 * `resolveHandle` overrides how the scene's asset handles are reconstructed from
 * their persistent GUIDs. By default they resolve against the App's registered
 * asset stores, so it is needed only to override that (e.g. tools/tests).
 *
 * This is a transient runtime load marker with no persistent identity — it is not
 * itself serialized into a scene.
 */
export class SceneRoot {
  /** The scene asset to instantiate under this entity. */
  readonly handle: Handle<Scene>;
  /** Resolver for asset handles referenced inside the scene, if any. */
  readonly resolveHandle?: SpawnSceneOptions['resolveHandle'];

  constructor(handle: Handle<Scene>, resolveHandle?: SpawnSceneOptions['resolveHandle']) {
    this.handle = handle;
    if (resolveHandle !== undefined) this.resolveHandle = resolveHandle;
  }
}

/**
 * The instantiated entity set of a {@link SceneRoot}, recorded on the root entity
 * once its scene has been spawned. Its presence marks the root as already
 * instantiated (so the reactor does not re-spawn it) and exposes the spawned
 * entities for inspection. Teardown despawns the root entity, which cascades to
 * the re-parented subtree — the recorded set need not be despawned one by one.
 *
 * Like {@link SceneRoot}, a transient runtime record — not serialized.
 */
export class SceneInstance {
  /** Every entity spawned for this instance, including the scene's top-level roots. */
  readonly entities: readonly Entity[];

  constructor(entities: readonly Entity[]) {
    this.entities = entities;
  }
}
