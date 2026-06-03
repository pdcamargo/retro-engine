import { Assets } from '@retro-engine/assets';

import type { SceneData } from './scene-data';

/**
 * A loadable scene asset: a reflection-driven entity graph in its serialized,
 * portable form. Wraps the {@link SceneData} envelope so a scene is a first-class
 * asset with its own {@link import('@retro-engine/assets').Handle} — loaded from a
 * `.scene` file (or built in memory), then brought into a live world by spawning a
 * `SceneRoot` that references it.
 *
 * The wrapper (rather than a bare `SceneData`) gives the asset a nominal identity
 * distinct from any other JSON payload and a home for future per-scene metadata.
 */
export class Scene {
  /** The serialized entity graph this scene spawns. */
  readonly data: SceneData;

  constructor(data: SceneData) {
    this.data = data;
  }
}

/**
 * App-level store mapping {@link import('@retro-engine/assets').Handle}s to
 * {@link Scene} instances. Inserted as a resource by `ScenePlugin`; the scene
 * loader commits parsed `.scene` files here, and runtime code may `scenes.add(...)`
 * an in-memory scene. The `SceneRoot` reactor reads from this store.
 */
export class Scenes extends Assets<Scene> {}
