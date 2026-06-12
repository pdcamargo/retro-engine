import { describe, expect, it } from 'bun:test';

import type { AssetGuid, AssetSource, Handle } from '@retro-engine/assets';
import { generateAssetGuid } from '@retro-engine/assets';
import type { ComponentType, Entity } from '@retro-engine/ecs';
import { World } from '@retro-engine/ecs';

import {
  App,
  AssetPlugin,
  Commands,
  type Logger,
  Name,
  Parent,
  Scene,
  type SceneData,
  type SerializedEntity,
  SceneInstance,
  SceneRoot,
  ScenePlugin,
  Scenes,
  Transform,
} from '../index';
import { serializeScene } from './serialize';
import { spawnScene } from './spawn';
import { makeHeadlessRenderer } from '../test-utils';

const emptySource: AssetSource = {
  read: (location) => Promise.reject(new Error(`missing: ${location}`)),
};

const transform = (x = 0, y = 0): SceneData['entities'][number]['components'][number] => ({
  type: 'Transform',
  version: 1,
  data: { translation: [x, y, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
});

const named = (value: string): SceneData['entities'][number]['components'][number] => ({
  type: 'Name',
  version: 1,
  data: { value },
});

/** A one-entity child scene: a single named, positioned entity. */
const childScene = (name: string, y = 0): SceneData => ({
  version: 1,
  entities: [{ id: 0, components: [transform(0, y), named(name)] }],
});

const countByName = (world: World, name: string): number => {
  let n = 0;
  for (const entity of world.entities()) {
    if (world.getComponent(entity, Name)?.value === name) n += 1;
  }
  return n;
};

const findByName = (world: World, name: string): Entity | undefined => {
  for (const entity of world.entities()) {
    if (world.getComponent(entity, Name)?.value === name) return entity;
  }
  return undefined;
};

const find = <T extends object>(world: World, type: ComponentType<T>): Entity | undefined => {
  for (const entity of world.entities()) {
    if (world.getComponent(entity, type) !== undefined) return entity;
  }
  return undefined;
};

const nameOf = (entity: SerializedEntity): string | undefined => {
  for (const c of entity.components) {
    if (c.type === 'Name') return (c.data as { value: string }).value;
  }
  return undefined;
};

const createDevWarnSpy = (): { logger: Logger; warns: string[] } => {
  const warns: string[] = [];
  const logger: Logger = {
    error: () => undefined,
    warn: () => undefined,
    info: () => undefined,
    debug: () => undefined,
    devWarn: (m) => {
      warns.push(m);
    },
    child: () => logger,
  };
  return { logger, warns };
};

/**
 * Build an App with the scene + asset plugins and a resolver that maps every
 * child scene's GUID to its in-store handle, so nested refs resolve with no
 * manifest (the tools/tests path of ADR-0071).
 */
const buildApp = (logger?: Logger) => {
  const app = new App(logger !== undefined ? { renderer: makeHeadlessRenderer(), logger } : { renderer: makeHeadlessRenderer() });
  app.addPlugin(new AssetPlugin({ source: emptySource }));
  app.addPlugin(new ScenePlugin());
  app.advanceFrame(0); // build plugins + register core components

  const byGuid = new Map<string, Handle<Scene>>();
  const resolveHandle = (_assetType: string, guid: string): Handle<unknown> => {
    const handle = byGuid.get(guid);
    if (handle === undefined) throw new Error(`test: no child scene for guid ${guid}`);
    return handle;
  };
  const addChild = (data: SceneData, guid: string = generateAssetGuid()): string => {
    byGuid.set(guid, app.getResource(Scenes)!.add(new Scene(data), guid as AssetGuid));
    return guid;
  };
  return { app, resolveHandle, addChild };
};

describe('scene composition — nested scene refs (ADR-0071)', () => {
  it('instantiates a nested child under its mount entity, named and positioned by the mount', () => {
    const { app, resolveHandle, addChild } = buildApp();
    const doorGuid = addChild(childScene('Door', 3));

    // Parent: a Level root with one mount entity "Room_A" at x=10 referencing Door.
    const parent: SceneData = {
      version: 1,
      entities: [
        { id: 0, components: [transform(), named('Level')] },
        {
          id: 1,
          components: [transform(10), named('Room_A'), { type: 'Parent', version: 1, data: { entity: 0 } }],
          scene: { guid: doorGuid },
        },
      ],
    };
    spawnScene(app, parent, undefined, { resolveHandle });
    app.advanceFrame(16); // reactor instantiates the nested child
    app.advanceFrame(16); // transform propagation settles

    // The mount keeps its OWN name + position (naming/positioning of the instance).
    const mount = findByName(app.world, 'Room_A')!;
    expect(app.world.getComponent(mount, Transform)!.translation[0]).toBe(10);
    expect(app.world.getComponent(mount, SceneInstance)).toBeInstanceOf(SceneInstance);

    // The child's entity exists and is re-parented under the mount.
    const door = findByName(app.world, 'Door')!;
    expect(app.world.getComponent(door, Parent)!.entity).toBe(mount);
  });

  it('instances the SAME child scene multiple times (per-entity ref = independent instances)', () => {
    const { app, resolveHandle, addChild } = buildApp();
    const doorGuid = addChild(childScene('Door'));

    const parent: SceneData = {
      version: 1,
      entities: [
        { id: 0, components: [transform(), named('Level')] },
        { id: 1, components: [transform(0), named('Room_A'), { type: 'Parent', version: 1, data: { entity: 0 } }], scene: { guid: doorGuid } },
        { id: 2, components: [transform(50), named('Room_B'), { type: 'Parent', version: 1, data: { entity: 0 } }], scene: { guid: doorGuid } },
      ],
    };
    spawnScene(app, parent, undefined, { resolveHandle });
    app.advanceFrame(16);
    app.advanceFrame(16);

    // Two independent Door instances, one under each room.
    expect(countByName(app.world, 'Door')).toBe(2);
    expect(countByName(app.world, 'Room_A')).toBe(1);
    expect(countByName(app.world, 'Room_B')).toBe(1);
  });

  it('round-trips: re-emits the ref, excludes the child entities, and re-instantiates on reload', () => {
    const { app, resolveHandle, addChild } = buildApp();
    const doorGuid = addChild(childScene('Door'));
    const parent: SceneData = {
      version: 1,
      entities: [
        { id: 0, components: [transform(), named('Level')] },
        { id: 1, components: [transform(10), named('Room_A'), { type: 'Parent', version: 1, data: { entity: 0 } }], scene: { guid: doorGuid } },
      ],
    };
    spawnScene(app, parent, undefined, { resolveHandle });
    app.advanceFrame(16);
    app.advanceFrame(16);

    const saved = JSON.parse(JSON.stringify(serializeScene(app))) as SceneData;

    // The mount re-emits the ref; the child's entity is NOT baked into the parent.
    const mount = saved.entities.find((e) => nameOf(e) === 'Room_A')!;
    expect(mount.scene).toEqual({ guid: doorGuid });
    expect(saved.entities.some((e) => nameOf(e) === 'Door')).toBe(false);
    expect(saved.entities.some((e) => nameOf(e) === 'Level')).toBe(true);

    // Reload into a fresh App: the link is live — the child re-instantiates.
    const fresh = buildApp();
    fresh.addChild(childScene('Door'), doorGuid); // same guid the saved ref points at
    spawnScene(fresh.app, saved, undefined, { resolveHandle: fresh.resolveHandle });
    fresh.app.advanceFrame(16);
    fresh.app.advanceFrame(16);
    expect(countByName(fresh.app.world, 'Door')).toBe(1);
    expect(countByName(fresh.app.world, 'Room_A')).toBe(1);
  });

  it('refuses an include cycle (self-reference) instead of spawning unboundedly, and warns', () => {
    const spy = createDevWarnSpy();
    const app = new App({ renderer: makeHeadlessRenderer(), logger: spy.logger });
    app.addPlugin(new AssetPlugin({ source: emptySource }));
    app.addPlugin(new ScenePlugin());
    app.advanceFrame(0);

    // A scene whose mount entity references its OWN guid.
    const guid = generateAssetGuid();
    const selfRef: SceneData = {
      version: 1,
      entities: [
        { id: 0, components: [transform(), named('Loop')] },
        { id: 1, components: [transform(), named('LoopMount'), { type: 'Parent', version: 1, data: { entity: 0 } }], scene: { guid } },
      ],
    };
    const scenes = app.getResource(Scenes)!;
    const handle = scenes.add(new Scene(selfRef), guid);
    const resolveHandle = (): Handle<unknown> => handle;
    app.world.entity(app.world.spawn()).insert(new SceneRoot(handle, resolveHandle), new Transform());

    for (let i = 0; i < 6; i += 1) app.advanceFrame(16);

    // One outer instance + its mount; the self-include is refused, not expanded.
    expect(countByName(app.world, 'Loop')).toBe(1);
    expect(countByName(app.world, 'LoopMount')).toBe(1);
    expect(spy.warns.some((m) => m.includes('cycle'))).toBe(true);
  });

  it('tears the whole nested instance down when an ancestor is despawned (cascade)', () => {
    const { app, resolveHandle, addChild } = buildApp();
    const doorGuid = addChild(childScene('Door'));
    const parentData: SceneData = {
      version: 1,
      entities: [
        { id: 0, components: [transform(), named('Level')] },
        { id: 1, components: [transform(), named('Room_A'), { type: 'Parent', version: 1, data: { entity: 0 } }], scene: { guid: doorGuid } },
      ],
    };
    const parentGuid = addChild(parentData);

    // Spawn the parent under a top SceneRoot so a single despawn cascades.
    let top: Entity = 0 as Entity;
    app.world.entity((top = app.world.spawn())).insert(new SceneRoot(app.getResource(Scenes)!.handleByGuid(parentGuid as AssetGuid)!, resolveHandle), new Transform());
    app.advanceFrame(16); // instantiate parent → creates Room_A mount
    app.advanceFrame(16); // instantiate the nested Door under Room_A
    app.advanceFrame(16);
    expect(countByName(app.world, 'Door')).toBe(1);

    // Despawn the top root: cascade tears down the parent AND the nested child.
    app.addSystem('update', [Commands], (cmd) => cmd.entity(top).despawn(), { label: 'teardown-once' });
    app.advanceFrame(16);
    app.advanceFrame(16);

    expect(countByName(app.world, 'Door')).toBe(0);
    expect(countByName(app.world, 'Room_A')).toBe(0);
    expect(find(app.world, SceneInstance)).toBeUndefined();
  });
});
