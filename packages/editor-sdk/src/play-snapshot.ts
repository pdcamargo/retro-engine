import type { Entity, World } from '@retro-engine/ecs';
import {
  type App,
  AppTypeRegistry,
  type DeserializeOptions,
  deserializeScene,
  type SceneData,
  serializeWorld,
  spawnScene,
} from '@retro-engine/engine';
import type { TypeRegistry } from '@retro-engine/reflect';

import { SimState } from './sim-state';

/**
 * Decides which entities are "authored" content (returns `true`) versus editor
 * infrastructure to leave untouched (returns `false`) — e.g.
 * `(e) => !world.has(e, EditorOnly)`.
 */
export type EntityFilter = (entity: Entity) => boolean;

/**
 * Serialize the entities passing `keep` (the authored scene) into a snapshot,
 * excluding editor-infra entities. Operates on a bare {@link World} so it needs
 * no App or renderer. Entity-only — registered resources are not captured (see
 * ADR-0152: play mode reverts entities, not resources).
 */
export const captureSnapshot = (
  world: World,
  registry: TypeRegistry,
  keep: EntityFilter,
): SceneData => serializeWorld(world, registry, { filter: keep });

/**
 * Revert `world` to `snapshot`: despawn every entity passing `keep` (the current
 * authored content, including play-time additions), then respawn the snapshot.
 * Returns the snapshot-id → new-`Entity` map so callers can remap anything keyed
 * on the old ids. Editor-infra entities (those failing `keep`) are untouched.
 */
export const restoreSnapshot = (
  world: World,
  registry: TypeRegistry,
  snapshot: SceneData,
  keep: EntityFilter,
  opts: DeserializeOptions = {},
): Map<number, Entity> => {
  for (const entity of [...world.entities()].filter(keep)) world.despawn(entity);
  return deserializeScene(snapshot, world, registry, opts);
};

const registryOf = (app: App): TypeRegistry => app.getResource(AppTypeRegistry)!.registry;

/** {@link captureSnapshot} against an App's world + registry. */
export const capturePlaySnapshot = (app: App, keep: EntityFilter): SceneData =>
  captureSnapshot(app.world, registryOf(app), keep);

/**
 * Revert an App to `snapshot`: despawn authored entities, then `spawnScene` the
 * snapshot (so asset handles resolve through the App's stores). Returns the
 * snapshot-id → new-`Entity` map.
 */
export const restorePlaySnapshot = (
  app: App,
  snapshot: SceneData,
  keep: EntityFilter,
): Map<number, Entity> => {
  for (const entity of [...app.world.entities()].filter(keep)) app.world.despawn(entity);
  return spawnScene(app, snapshot);
};

/** Holds the pre-play snapshot between entering and leaving play mode. */
export class PlaySnapshotStore {
  snapshot: SceneData | undefined;
}

/** Options for {@link installPlayModeSnapshot}. */
export interface PlayModeSnapshotOptions {
  /** Which entities are authored content to snapshot/revert. */
  readonly keep: EntityFilter;
  /**
   * Called after a restore with the snapshot-id → new-`Entity` map, so the host
   * can remap selection/editor state that keyed on the pre-play ids.
   */
  readonly onRestore?: (idMap: Map<number, Entity>) => void;
}

/**
 * Wire snapshot-on-Play / restore-on-Stop to {@link SimState} transitions:
 * leaving `Edit` (→ `Play`) captures the authored scene; entering `Edit`
 * (`Play`/`Paused` → `Edit`) restores it and clears the snapshot. Keying on
 * `Edit` means `Paused ⇄ Play` never captures/restores and the initial `Edit`
 * entry (no snapshot yet) is a no-op, so startup never wipes the scene.
 *
 * Requires `SimState` to be registered ({@link initSimState}) first.
 */
export const installPlayModeSnapshot = (app: App, options: PlayModeSnapshotOptions): void => {
  const store = new PlaySnapshotStore();
  app.insertResource(store);

  app.onExit(SimState.Edit, [], () => {
    store.snapshot = capturePlaySnapshot(app, options.keep);
  });

  app.onEnter(SimState.Edit, [], () => {
    if (store.snapshot === undefined) return;
    const idMap = restorePlaySnapshot(app, store.snapshot, options.keep);
    store.snapshot = undefined;
    options.onRestore?.(idMap);
  });
};
