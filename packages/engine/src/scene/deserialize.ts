import type { Entity, World } from '@retro-engine/ecs';
import type { Handle } from '@retro-engine/assets';
import type { DecodeEnv, TypeRegistry } from '@retro-engine/reflect';
import { decodeComponent } from '@retro-engine/reflect';

import type { SceneData } from './scene-data';

/** Options for {@link deserializeScene}. */
export interface DeserializeOptions {
  /**
   * Reconstruct an asset handle from its persistent reference. Required if the
   * scene contains any handle fields — there is no global GUID→handle resolver,
   * so the caller supplies one (backed by its asset stores).
   */
  resolveHandle?(assetType: string, guid: string): Handle<unknown>;
  /**
   * Entity returned for a reference whose target is not part of the scene.
   * Defaults to entity `0`, which is never a live id (ids start at `1`).
   */
  nullEntity?: Entity;
}

/**
 * Spawn a {@link SceneData} into `world` and return the scene-id → entity remap.
 *
 * Runs in two phases so references resolve regardless of order: first every
 * serialized entity is spawned empty and recorded in the map, then each
 * entity's components are decoded — entity-typed fields remapped through the
 * map, handle fields resolved via {@link DeserializeOptions.resolveHandle} — and
 * inserted. Components write directly into the world, so engine lifecycle hooks
 * are not invoked.
 */
export const deserializeScene = (
  scene: SceneData,
  world: World,
  registry: TypeRegistry,
  opts: DeserializeOptions = {},
): Map<number, Entity> => {
  const idToEntity = new Map<number, Entity>();
  for (const entity of scene.entities) {
    idToEntity.set(entity.id, world.spawn());
  }

  const nullEntity = opts.nullEntity ?? (0 as Entity);
  const env: DecodeEnv = {
    registry,
    entity: (id) => idToEntity.get(id) ?? nullEntity,
    resolveHandle:
      opts.resolveHandle ??
      (() => {
        throw new Error(
          'deserializeScene: the scene references asset handles — pass resolveHandle to restore them',
        );
      }),
  };

  for (const serialized of scene.entities) {
    const entity = idToEntity.get(serialized.id)!;
    const components: object[] = [];
    for (const component of serialized.components) {
      const reg = registry.get(component.type);
      if (reg === undefined) continue;
      components.push(decodeComponent(reg, component, env));
    }
    if (components.length > 0) world.entity(entity).insert(...components);
  }

  return idToEntity;
};
