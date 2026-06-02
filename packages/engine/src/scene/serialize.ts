import type { Entity, World } from '@retro-engine/ecs';
import type { Handle } from '@retro-engine/assets';
import type { EncodeEnv, TypeRegistry } from '@retro-engine/reflect';
import { encodeComponent } from '@retro-engine/reflect';

import { SCENE_FORMAT_VERSION, type SceneData, type SerializedComponent } from './scene-data';

/** Options for {@link serializeWorld}. */
export interface SerializeOptions {
  /**
   * Persistent reference for an asset handle, or `undefined` to omit it.
   * Defaults to the handle's GUID — a handle with no GUID (a runtime-only asset)
   * has no persistent identity and is dropped.
   */
  handleRef?(assetType: string, handle: Handle<unknown>): string | undefined;
}

const guidRef = (_assetType: string, handle: Handle<unknown>): string | undefined => handle.guid;

/**
 * Serialize a world's entities to {@link SceneData}. Only components whose type
 * is registered in `registry` are emitted; entities receive compact ids and
 * entity-typed fields are remapped to those ids, so the graph survives the
 * round-trip through {@link deserializeScene}.
 */
export const serializeWorld = (
  world: World,
  registry: TypeRegistry,
  opts: SerializeOptions = {},
): SceneData => {
  const live = [...world.entities()];
  const idOf = new Map<Entity, number>();
  live.forEach((entity, i) => idOf.set(entity, i));

  const env: EncodeEnv = {
    registry,
    entityId: (entity) => idOf.get(entity) ?? -1,
    handleRef: opts.handleRef ?? guidRef,
  };

  const entities = live.map((entity) => {
    const components: SerializedComponent[] = [];
    for (const ctor of world.componentTypesOf(entity)) {
      const reg = registry.getByCtor(ctor);
      if (reg === undefined) continue;
      const value = world.getComponent(entity, ctor);
      if (value === undefined) continue;
      components.push(encodeComponent(reg, value, env));
    }
    return { id: idOf.get(entity)!, components };
  });

  return { version: SCENE_FORMAT_VERSION, entities };
};
