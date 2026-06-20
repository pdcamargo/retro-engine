import type { Entity, World } from '@retro-engine/ecs';
import type { Handle } from '@retro-engine/assets';
import type { EncodeEnv, SerializedValue, TypeRegistry } from '@retro-engine/reflect';
import { encodeComponent } from '@retro-engine/reflect';

import type { App } from '../index';
import { AppTypeRegistry } from './app-type-registry';
import {
  SCENE_FORMAT_VERSION,
  type SceneData,
  type SerializedComponent,
  type SerializedEntity,
} from './scene-data';
import { SceneInstance, SceneRoot } from './scene-root';

/**
 * The result of scanning a world for composition mount entities — those carrying
 * both a {@link SceneRoot} and a {@link SceneInstance}.
 *
 * @internal
 */
interface Composition {
  /**
   * Entities that belong to a nested child instance. Excluded from this scene's
   * output — they live in the child `.scene` file, not this one.
   */
  readonly excluded: ReadonlySet<Entity>;
  /**
   * For each mount entity with a GUID-bearing handle, the child scene GUID to
   * re-emit as a `scene` ref. A mount whose handle has no GUID is runtime-only:
   * its instance entities are still excluded, but no ref is emitted.
   */
  readonly sceneRefOf: ReadonlyMap<Entity, string>;
}

/**
 * Scan the world for composition mount entities and derive what serialization
 * must do for each: exclude the child's instantiated entities, and re-emit the
 * mount as a `scene` ref. A non-composed world yields empty sets, so it
 * serializes byte-identically to before.
 *
 * @internal Shared by {@link serializeWorld} and {@link serializeScene}.
 */
const collectComposition = (world: World): Composition => {
  const excluded = new Set<Entity>();
  const sceneRefOf = new Map<Entity, string>();
  for (const entity of world.entities()) {
    const instance = world.getComponent(entity, SceneInstance);
    if (instance === undefined) continue;
    const root = world.getComponent(entity, SceneRoot);
    if (root === undefined) continue;
    for (const child of instance.entities) excluded.add(child);
    const guid = root.handle.guid;
    if (guid !== undefined) sceneRefOf.set(entity, guid);
  }
  return { excluded, sceneRefOf };
};

/** Options for {@link serializeWorld}. */
export interface SerializeOptions {
  /**
   * Persistent reference for an asset handle, or `undefined` to omit it.
   * Defaults to the handle's GUID — a handle with no GUID (a runtime-only asset)
   * has no persistent identity and is dropped.
   */
  handleRef?(assetType: string, handle: Handle<unknown>): string | undefined;
  /**
   * Keep only the entities for which this returns true. Defaults to all live
   * entities. Used to capture just a subset of a mixed world — e.g. the hot-reload
   * snapshot keeps the user scene and drops the editor's own infra entities.
   */
  filter?(entity: Entity): boolean;
}

const guidRef = (_assetType: string, handle: Handle<unknown>): string | undefined => handle.guid;

/**
 * Build the {@link EncodeEnv} shared by every scene-serializing path: it assigns
 * each live entity a compact id (`0..N`), threads the registry, and resolves
 * asset handles to their persistent reference (the handle's GUID by default).
 * Returning `idOf` and `live` lets entities and App resources encode against the
 * SAME ids, so an entity-typed field on a resource remaps to the same target an
 * entity-typed field on a component would.
 *
 * @internal Shared by {@link serializeWorld} (entities) and {@link serializeScene}
 *   (entities + resources).
 */
export const buildEncodeEnv = (
  world: World,
  registry: TypeRegistry,
  opts: SerializeOptions,
): { env: EncodeEnv; idOf: ReadonlyMap<Entity, number>; live: readonly Entity[] } => {
  const all = [...world.entities()];
  const live = opts.filter !== undefined ? all.filter(opts.filter) : all;
  const idOf = new Map<Entity, number>();
  live.forEach((entity, i) => idOf.set(entity, i));

  const env: EncodeEnv = {
    registry,
    entityId: (entity) => idOf.get(entity) ?? -1,
    handleRef: opts.handleRef ?? guidRef,
  };

  return { env, idOf, live };
};

const serializeEntities = (
  world: World,
  registry: TypeRegistry,
  env: EncodeEnv,
  idOf: ReadonlyMap<Entity, number>,
  live: readonly Entity[],
  composition: Composition,
): SerializedEntity[] => {
  const out: SerializedEntity[] = [];
  for (const entity of live) {
    if (composition.excluded.has(entity)) continue;
    const components: SerializedComponent[] = [];
    for (const ctor of world.componentTypesOf(entity)) {
      const reg = registry.getByCtor(ctor);
      if (reg === undefined) continue;
      const value = world.getComponent(entity, ctor);
      if (value === undefined) continue;
      components.push(encodeComponent(reg, value, env));
    }
    const guid = composition.sceneRefOf.get(entity);
    out.push(
      guid !== undefined
        ? { id: idOf.get(entity)!, components, scene: { guid } }
        : { id: idOf.get(entity)!, components },
    );
  }
  return out;
};

/**
 * Encode every registered App resource currently present into its
 * {@link SerializedValue} envelope, against the same `env` (and therefore the
 * same entity ids) the entities serialized with. A registered resource the App
 * does not currently hold is skipped — mirroring how an entity omits a component
 * it lacks.
 */
const serializeResources = (app: App, env: EncodeEnv): SerializedValue[] => {
  const atr = app.getResource(AppTypeRegistry)!;
  const out: SerializedValue[] = [];
  for (const [ctor, reg] of atr.resources) {
    // `ctor` keys an App resource; the cast adapts the registry's
    // `never[]`-param constructor type to `getResource`'s rest-param signature.
    const value = app.getResource(ctor as unknown as new () => object);
    if (value === undefined) continue;
    out.push(encodeComponent(reg, value, env));
  }
  return out;
};

/**
 * Serialize a world's entities to {@link SceneData}. Only components whose type
 * is registered in `registry` are emitted; entities receive compact ids and
 * entity-typed fields are remapped to those ids, so the graph survives the
 * round-trip through {@link deserializeScene}.
 *
 * This is the bare-world path — it has no App, so it never emits resources. Use
 * {@link serializeScene} to capture an App's registered resources alongside its
 * entities.
 */
export const serializeWorld = (
  world: World,
  registry: TypeRegistry,
  opts: SerializeOptions = {},
): SceneData => {
  const { env, idOf, live } = buildEncodeEnv(world, registry, opts);
  return {
    version: SCENE_FORMAT_VERSION,
    entities: serializeEntities(world, registry, env, idOf, live, collectComposition(world)),
  };
};

/**
 * Serialize an App's world *and* its registered resources, using the App's own
 * reflection registry — the convenience over {@link serializeWorld} that saves
 * the caller from reaching for the {@link AppTypeRegistry} resource, and the only
 * path that captures resources. Resources encode against the same entity ids the
 * entities use; the `resources` key is omitted when no registered resource is
 * present, so a resource-free App serializes identically to
 * {@link serializeWorld}. Pairs with {@link spawnScene} on the load side.
 */
export const serializeScene = (app: App, opts: SerializeOptions = {}): SceneData => {
  const registry = app.getResource(AppTypeRegistry)!.registry;
  const { env, idOf, live } = buildEncodeEnv(app.world, registry, opts);
  const entities = serializeEntities(
    app.world,
    registry,
    env,
    idOf,
    live,
    collectComposition(app.world),
  );
  const resources = serializeResources(app, env);
  return resources.length > 0
    ? { version: SCENE_FORMAT_VERSION, entities, resources }
    : { version: SCENE_FORMAT_VERSION, entities };
};
