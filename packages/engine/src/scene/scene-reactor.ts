import type { Entity } from '@retro-engine/ecs';

import { Commands } from '../commands';
import { Parent } from '../hierarchy';
import type { App } from '../index';
import { Query, Res } from '../system-param';

import type { Scene } from './scene-asset';
import { Scenes } from './scene-asset';
import { SceneInstance, SceneRoot } from './scene-root';
import { spawnScene } from './spawn';

/**
 * Whether instantiating the scene `guid` under `entity` would form a cycle — i.e.
 * an ancestor `SceneRoot` in `entity`'s `Parent` chain already instantiates the
 * same scene. Walking the live hierarchy recovers the full include-chain because
 * each nested instance is re-parented under its mount entity, so no cycle state is
 * stored on `SceneRoot`. A guid-less child can never form a guid cycle.
 */
const wouldCycle = (app: App, entity: Entity, guid: string | undefined): boolean => {
  if (guid === undefined) return false;
  let current = app.world.getComponent(entity, Parent)?.entity;
  while (current !== undefined) {
    const ancestor = app.world.getComponent(current, SceneRoot);
    if (ancestor !== undefined && ancestor.handle.guid === guid) return true;
    current = app.world.getComponent(current, Parent)?.entity;
  }
  return false;
};

/**
 * Register the scene instantiation reactor on `app`. Each `update` frame it scans
 * {@link SceneRoot} entities not yet instantiated, polls the {@link Scenes} store
 * for the handle's value (the store-presence idiom — there is no asset-ready
 * event), and on readiness spawns the scene's entity graph, re-parents the
 * scene's top-level entities under the root, and records a {@link SceneInstance}.
 *
 * Runs in `update` so `postUpdate` transform propagation reaches the new entities
 * the same frame. The scene's top-level (parent-less) entities become children of
 * the root so the root's `Transform` offsets the whole instance and a single
 * despawn of the root tears it down.
 */
export const addSceneInstantiation = (app: App): void => {
  app.addSystem(
    'update',
    [Commands, Res(Scenes), Query([SceneRoot], { without: [SceneInstance] })],
    (cmd, scenes, roots) => {
      // Pass 1 — snapshot ready roots. spawnScene flushes the command buffer
      // internally, which is undefined behavior while this Query iterator is
      // live, so collect the targets before spawning any of them. A root that
      // would close an include cycle is refused (and marked done with an empty
      // instance so it is neither retried nor re-warned each frame).
      const ready: { entity: Entity; root: SceneRoot; scene: Scene }[] = [];
      const cyclic: Entity[] = [];
      for (const [entity, root] of roots.entries()) {
        const scene = scenes.get(root.handle);
        if (scene === undefined) continue;
        if (wouldCycle(app, entity, root.handle.guid)) {
          app.logger.devWarn(
            `scene composition: refusing to instantiate scene '${String(root.handle.guid)}' — it is already an ancestor (include cycle).`,
          );
          cyclic.push(entity);
          continue;
        }
        ready.push({ entity, root, scene });
      }
      for (const entity of cyclic) cmd.entity(entity).insert(new SceneInstance([]));

      // Pass 2 — instantiate each (the iterator is no longer live). spawnScene
      // reserves ids, wires the scene's internal hierarchy from the Parent edge,
      // and flushes; afterwards a scene entity with no Parent is a top-level root
      // and gets re-parented under this SceneRoot entity.
      for (const { entity, root, scene } of ready) {
        const opts = root.resolveHandle !== undefined ? { resolveHandle: root.resolveHandle } : {};
        const idMap = spawnScene(app, scene.data, undefined, opts);
        const ec = cmd.entity(entity);
        const spawned: Entity[] = [];
        for (const e of idMap.values()) {
          spawned.push(e);
          if (app.world.getComponent(e, Parent) === undefined) ec.addChild(e);
        }
        ec.insert(new SceneInstance(spawned));
      }
    },
    { label: 'scene-instantiate' },
  );
};
