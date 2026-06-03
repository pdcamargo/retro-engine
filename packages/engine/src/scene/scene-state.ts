import type { Entity } from '@retro-engine/ecs';
import type { Handle } from '@retro-engine/assets';

import { Commands } from '../commands';
import type { App } from '../index';
import { Transform } from '../transform';

import type { Scene } from './scene-asset';
import { SceneRoot } from './scene-root';
import type { SpawnSceneOptions } from './spawn';

/** Options for {@link registerSceneState} / `App.addScene`. */
export interface AddSceneOptions {
  /**
   * Resolver for asset handles referenced inside the scene, forwarded to the
   * `SceneRoot`. Required only if the scene contains handle fields.
   */
  resolveHandle?: SpawnSceneOptions['resolveHandle'];
}

/**
 * Tracks the live `SceneRoot` entity spawned for each state-bound scene, keyed by
 * the state value. Inserted lazily by {@link registerSceneState}; lets the
 * `OnExit` teardown find and despawn the entity its `OnEnter` spawned.
 */
export class SceneStateRoots {
  /** Active scene-root entity per bound state value. */
  readonly byState = new Map<object, Entity>();
}

/**
 * Bind a scene to a state value: spawn a {@link SceneRoot} on `OnEnter(state)` and
 * despawn it on `OnExit(state)`. The reactor instantiates the scene under the root
 * the same frame the asset is ready; despawning the root on exit cascades through
 * the subtree, tearing the instance down with no leaked entities.
 *
 * Teardown order is `OnExit` registration order: because the despawn is registered
 * here as an `OnExit` system, any `OnExit` systems registered **before** this call
 * run before the scene is despawned (so they can read the live scene one last
 * time); state-scoped resources are removed afterwards by the state machine.
 */
export const registerSceneState = <S extends object>(
  app: App,
  state: S,
  handle: Handle<Scene>,
  opts?: AddSceneOptions,
): void => {
  let roots = app.getResource(SceneStateRoots);
  if (roots === undefined) {
    roots = new SceneStateRoots();
    app.insertResource(roots);
  }
  const tracker = roots;

  app.onEnter(state, [Commands], (cmd) => {
    tracker.byState.set(state, cmd.spawn(new SceneRoot(handle, opts?.resolveHandle), new Transform()).id);
  });

  app.onExit(state, [Commands], (cmd) => {
    const entity = tracker.byState.get(state);
    if (entity === undefined) return;
    cmd.entity(entity).despawn();
    tracker.byState.delete(state);
  });
};
