import type { Entity } from '@retro-engine/ecs';
import type { AssetGuid, Handle } from '@retro-engine/assets';
import type { DecodeEnv, SerializedValue, TypeRegistry } from '@retro-engine/reflect';
import { decodeComponent } from '@retro-engine/reflect';

import { AssetServer } from '../asset/asset-server';
import { AssetStores } from '../asset/asset-stores';
import { Commands, type CommandsHandle } from '../commands';
import { Parent } from '../hierarchy';
import type { App } from '../index';
import { ObserverHandlerRegistry } from '../observer-binding/handler-registry';
import { resolveObserverBindings } from '../observer-binding/scene-binding';
import { TemplateRegistry } from '../prefab/template-registry';
import { expandTemplateRefs } from '../prefab/template-scene';

import { AppTypeRegistry } from './app-type-registry';
import { buildDecodeEnv } from './deserialize';
import type { Scene } from './scene-asset';
import type { SceneData } from './scene-data';
import { SceneRoot } from './scene-root';

/**
 * Resolve a nested scene reference's GUID to its `Handle<Scene>`. A caller-injected
 * `resolveHandle` wins (tools/tests, in-memory children); otherwise the child is
 * loaded by GUID through the App's {@link AssetServer}, which returns the handle
 * immediately and kicks the child file's load. Throws when neither is available —
 * composition by GUID needs a manifest-backed `AssetServer` or an explicit resolver.
 *
 * @internal Used by {@link spawnScene} to turn a `scene` ref into a `SceneRoot`.
 */
const resolveSceneRef = (
  app: App,
  guid: string,
  resolveHandle: SpawnSceneOptions['resolveHandle'],
): Handle<Scene> => {
  if (resolveHandle !== undefined) return resolveHandle('Scene', guid) as Handle<Scene>;
  const server = app.getResource(AssetServer);
  if (server === undefined) {
    throw new Error(
      `scene composition: entity references child scene '${guid}' but the App has no AssetServer and no resolveHandle was provided`,
    );
  }
  return server.loadByGuid<Scene>(guid as AssetGuid);
};

/**
 * Decode a scene's serialized resources and insert them into the App, using the
 * same {@link DecodeEnv} the entities decoded against so resource entity- and
 * handle-typed fields remap/resolve identically. A resource whose type is not
 * registered is skipped (forward-compat with scenes written by a newer build).
 *
 * @internal Called by {@link spawnScene} after the entity pass.
 */
const applyResources = (
  app: App,
  resources: readonly SerializedValue[],
  registry: TypeRegistry,
  env: DecodeEnv,
): void => {
  for (const sv of resources) {
    const reg = registry.get(sv.type);
    if (reg === undefined) continue;
    app.insertResource(decodeComponent(reg, sv, env));
  }
};

/** Options for {@link spawnScene}. */
export interface SpawnSceneOptions {
  /**
   * Override for reconstructing an asset handle from its persistent reference.
   * By default handles resolve by GUID against the App's registered asset
   * stores (its {@link AssetStores} resource); pass this only to override that —
   * e.g. tools/tests, or a scene whose assets live outside the App's stores.
   */
  resolveHandle?(assetType: string, guid: string): Handle<unknown>;
  /**
   * Entity used for a reference whose target is not part of the scene.
   * Defaults to entity `0`, which is never a live id (ids start at `1`).
   */
  nullEntity?: Entity;
}

/**
 * Spawn a {@link SceneData} into a live App through its command buffer, and
 * return the scene-id → entity remap.
 *
 * Unlike {@link deserializeScene} — which writes straight into a bare world —
 * this drives every spawn, insert, and parent link through `Commands`, so the
 * engine's lifecycle hooks fire, Required Components resolve, and the hierarchy
 * wires the same way runtime spawning does. Concretely: a parent's `Children`
 * is rebuilt from each child's serialized `Parent` edge (never serialized
 * directly), and a frame later the propagation systems recompute the derived
 * state (`GlobalTransform`, inherited visibility) that scenes never persist.
 *
 * Runs in two passes so references resolve regardless of order: first every
 * serialized entity is reserved (an empty spawn whose id is available
 * synchronously), then each entity's components are decoded and inserted — with
 * the `Parent` edge routed through `addChild` rather than inserted, so the
 * reciprocal `Children` is built and its hooks fire. After an entity's
 * components, its `observers` bindings are attached by name (resolved against the
 * App's registered handlers), through the same command path as a code-side
 * `commands.entity(e).observe`. Finally, any resources the scene carried
 * (`SceneData.resources`) are decoded and inserted on the App against the same
 * decode env. The buffer flushes before returning.
 *
 * @param registry - The registry to decode against. Defaults to the App's
 *   {@link AppTypeRegistry} resource; pass an explicit one for tools/tests.
 */
export const spawnScene = (
  app: App,
  scene: SceneData,
  registry: TypeRegistry = app.getResource(AppTypeRegistry)!.registry,
  opts: SpawnSceneOptions = {},
): Map<number, Entity> => {
  const cmd = Commands.resolve({
    app,
    world: app.world,
    stage: 'update',
    systemId: app.mintSystemId(),
    lastSeenTick: 0,
    lastSeenFrame: -1,
  }) as CommandsHandle;

  // Pass 1: reserve every id up front so all parent/child ends are live at
  // flush regardless of declaration order. The empty spawn fires no hooks.
  const idToEntity = new Map<number, Entity>();
  for (const entity of scene.entities) idToEntity.set(entity.id, cmd.spawn().id);

  // No injected resolver → resolve handles by GUID against the App's registered
  // asset stores. An injected resolver always wins; with neither, decoding a
  // handle field throws (buildDecodeEnv's fallback).
  const stores = app.getResource(AssetStores);
  const decodeOpts: SpawnSceneOptions =
    opts.resolveHandle === undefined && stores !== undefined
      ? { ...opts, resolveHandle: (assetType, guid) => stores.handleFor(assetType, guid) }
      : opts;

  const env = buildDecodeEnv(registry, idToEntity, decodeOpts);
  const parentReg = registry.getByCtor(Parent);
  const templateReg = app.getResource(TemplateRegistry);
  const handlerReg = app.getResource(ObserverHandlerRegistry);

  // Pass 2: decode + insert every component except Parent, which is routed
  // through addChild so the appendChild op wires both sides and fires hooks.
  // Embedded templates expand first, so an explicit component of the same type
  // overrides the template's output (resolveBundle keeps the last value on insert).
  for (const serialized of scene.entities) {
    const entity = idToEntity.get(serialized.id)!;
    const components: object[] = [];

    if (
      serialized.templates !== undefined &&
      serialized.templates.length > 0 &&
      templateReg !== undefined
    ) {
      for (const produced of expandTemplateRefs(templateReg, registry, serialized.templates, env)) {
        if (produced instanceof Parent) {
          cmd.entity(produced.entity).addChild(entity);
          continue;
        }
        components.push(produced);
      }
    }

    for (const component of serialized.components) {
      const reg = registry.get(component.type);
      if (reg === undefined) continue;
      if (parentReg !== undefined && reg === parentReg) {
        const parent = decodeComponent(reg, component, env) as Parent;
        cmd.entity(parent.entity).addChild(entity);
        continue;
      }
      components.push(decodeComponent(reg, component, env));
    }
    if (components.length > 0) cmd.entity(entity).insert(...components);

    // Attach this entity's observer bindings by name (after components, so an
    // observer body can already read them). Each rides the same command path as
    // a code-side `cmd.entity(e).observe`, so cleanup-on-despawn applies.
    if (
      serialized.observers !== undefined &&
      serialized.observers.length > 0 &&
      handlerReg !== undefined
    ) {
      for (const handler of resolveObserverBindings(handlerReg, serialized.observers)) {
        cmd.entity(entity).observe(handler.event, handler.params, handler.run);
      }
    }

    // A nested scene reference becomes a SceneRoot on this entity; the
    // instantiation reactor expands the child under it on a later frame
    // (recursing through any deeper refs), and the cascade tears it down. The
    // caller's resolveHandle propagates onto the nested root so the whole
    // subtree resolves the same way.
    if (serialized.scene !== undefined) {
      const handle = resolveSceneRef(app, serialized.scene.guid, opts.resolveHandle);
      cmd.entity(entity).insert(new SceneRoot(handle, opts.resolveHandle));
    }
  }

  // Restore the scene's registered resources against the same env, so a resource
  // field referencing a scene entity or asset handle resolves like a component's
  // would. Inserted directly on the App (resources have no entity identity); the
  // reserved entity ids are already live, so this is order-independent of flush.
  if (scene.resources !== undefined && scene.resources.length > 0) {
    applyResources(app, scene.resources, registry, env);
  }

  app.flushCommands();
  return idToEntity;
};
