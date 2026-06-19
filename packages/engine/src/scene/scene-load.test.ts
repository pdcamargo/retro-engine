import { describe, expect, it } from 'bun:test';

import type { ComponentType, Entity } from '@retro-engine/ecs';
import { World } from '@retro-engine/ecs';
import type { AssetSource } from '@retro-engine/assets';

import {
  App,
  AssetPlugin,
  AssetServer,
  Commands,
  GlobalTransform,
  type Logger,
  Name,
  Parent,
  ResMut,
  Scene,
  type SceneData,
  SceneInstance,
  SceneRoot,
  ScenePlugin,
  Scenes,
  SceneStateRoots,
  Transform,
  createSceneSerializer,
} from '../index';
import { NextState } from '../state';
import { makeHeadlessRenderer } from '../test-utils';

/** A two-entity scene: a named root with one named child linked by a Parent edge. No handles. */
const cubeScene = (): SceneData => ({
  version: 1,
  entities: [
    {
      id: 0,
      components: [
        { type: 'Transform', version: 1, data: { translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] } },
        { type: 'Name', version: 1, data: { value: 'scene-root' } },
      ],
    },
    {
      id: 1,
      components: [
        { type: 'Transform', version: 1, data: { translation: [0, 5, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] } },
        { type: 'Name', version: 1, data: { value: 'scene-child' } },
        { type: 'Parent', version: 1, data: { entity: 0 } },
      ],
    },
  ],
});

const find = <T extends object>(world: World, type: ComponentType<T>): Entity => {
  for (const entity of world.entities()) {
    if (world.getComponent(entity, type) !== undefined) return entity;
  }
  throw new Error('no entity with the requested component');
};

const findByName = (world: World, name: string): Entity | undefined => {
  for (const entity of world.entities()) {
    if (world.getComponent(entity, Name)?.value === name) return entity;
  }
  return undefined;
};

const countByName = (world: World, name: string): number => {
  let n = 0;
  for (const entity of world.entities()) {
    if (world.getComponent(entity, Name)?.value === name) n += 1;
  }
  return n;
};

const sourceFrom = (entries: Record<string, string>): AssetSource => ({
  read: (location) => {
    const value = entries[location];
    return value === undefined
      ? Promise.reject(new Error(`missing: ${location}`))
      : Promise.resolve(new TextEncoder().encode(value));
  },
});

const createWarnSpy = (): { logger: Logger; warns: string[] } => {
  const warns: string[] = [];
  const logger: Logger = {
    error: () => undefined,
    warn: (m) => {
      warns.push(m);
    },
    info: () => undefined,
    debug: () => undefined,
    devWarn: () => undefined,
    child: () => logger,
  };
  return { logger, warns };
};

class SceneId {
  static readonly Boot = new SceneId('Boot');
  static readonly Level = new SceneId('Level');
  constructor(public readonly name: string) {}
}

class LevelRes {
  readonly tag = 'level';
}

describe('SceneRoot reactor — spawn + reparent (no States)', () => {
  it('instantiates the scene under the root, rebuilds hierarchy, and records the instance', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    app.addPlugin(new AssetPlugin({ source: sourceFrom({}) }));
    app.addPlugin(new ScenePlugin());

    const data = cubeScene();
    app.addSystem('startup', [ResMut(Scenes), Commands], (scenes, cmd) => {
      const handle = scenes.add(new Scene(data));
      cmd.spawn(new SceneRoot(handle), new Transform());
    });

    app.advanceFrame(0); // build → startup spawns root → reactor instantiates
    app.advanceFrame(16); // transform propagation settles

    // The root recorded a SceneInstance covering exactly the scene's entities.
    const rootEntity = find(app.world, SceneInstance);
    const instance = app.world.getComponent(rootEntity, SceneInstance)!;
    expect(instance.entities.length).toBe(data.entities.length);

    // The scene's top-level entity ('scene-root') was re-parented under the root.
    const sceneRoot = findByName(app.world, 'scene-root')!;
    expect(app.world.getComponent(sceneRoot, Parent)!.entity).toBe(rootEntity);

    // Internal hierarchy preserved: 'scene-child' still parented to 'scene-root'.
    const sceneChild = findByName(app.world, 'scene-child')!;
    expect(app.world.getComponent(sceneChild, Parent)!.entity).toBe(sceneRoot);

    // GlobalTransform recomputed by propagation: child world y = 5 (root identity).
    const childGlobal = app.world.getComponent(sceneChild, GlobalTransform)!;
    expect(childGlobal.matrix[13]).toBeCloseTo(5, 5);

    // The reactor runs exactly once — no SceneInstance churn / duplicate spawn.
    expect(countByName(app.world, 'scene-root')).toBe(1);
  });
});

describe('App.addScene — States-gated lifecycle', () => {
  it('spawns on OnEnter and tears down on OnExit, ordering user OnExit before despawn', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    app.addPlugin(new AssetPlugin({ source: sourceFrom({}) }));
    app.addPlugin(new ScenePlugin());
    app.initState(SceneId, SceneId.Boot);

    app.advanceFrame(0); // build plugins + fire initial OnEnter(Boot)
    const baseline = Array.from(app.world.entities()).length;

    const scenes = app.getResource(Scenes)!;
    const handle = scenes.add(new Scene(cubeScene()));

    // A user OnExit registered BEFORE addScene must see the scene alive.
    let childrenAliveDuringUserExit = -1;
    app.onExit(SceneId.Level, [], () => {
      childrenAliveDuringUserExit = countByName(app.world, 'scene-child');
    });
    app.insertStateScopedResource(SceneId.Level, new LevelRes());
    app.addScene(SceneId.Level, handle);

    // Transition Boot → Level: OnEnter spawns the root, the reactor instantiates.
    app.getResource(NextState(SceneId))!.set(SceneId.Level);
    app.advanceFrame(16);
    app.advanceFrame(16);

    expect(countByName(app.world, 'scene-child')).toBe(1);
    expect(app.getResource(LevelRes)).toBeInstanceOf(LevelRes);
    expect(app.getResource(SceneStateRoots)!.byState.has(SceneId.Level)).toBe(true);

    // Transition Level → Boot: user OnExit (alive) → despawn cascade → drop LevelRes.
    app.getResource(NextState(SceneId))!.set(SceneId.Boot);
    app.advanceFrame(16);

    expect(childrenAliveDuringUserExit).toBe(1); // user OnExit ran before despawn
    expect(countByName(app.world, 'scene-child')).toBe(0); // torn down
    expect(app.getResource(LevelRes)).toBeUndefined(); // scoped resource removed
    expect(app.getResource(SceneStateRoots)!.byState.has(SceneId.Level)).toBe(false);

    // No leaked entities: back to the pre-enter baseline, no scene markers left.
    expect(Array.from(app.world.entities()).length).toBe(baseline);
    expect(() => find(app.world, SceneRoot)).toThrow();
    expect(() => find(app.world, SceneInstance)).toThrow();
  });
});

describe('Scene asset loading', () => {
  it('loads a .rescene file through the AssetServer into the Scenes store', async () => {
    const data = cubeScene();
    const app = new App({ renderer: makeHeadlessRenderer() });
    app.addPlugin(new AssetPlugin({ source: sourceFrom({ 'level.rescene': JSON.stringify(data) }) }));
    app.addPlugin(new ScenePlugin());
    app.advanceFrame(0); // build → registers the '.rescene' loader

    const server = app.getResource(AssetServer)!;
    const handle = server.load<Scene>('level.rescene');
    await server.settle();
    app.advanceFrame();

    const scenes = app.getResource(Scenes)!;
    const scene = scenes.get(handle);
    expect(scene).toBeInstanceOf(Scene);
    expect(scene!.data.entities.length).toBe(data.entities.length);
  });

  it('fails the load (no commit) on an unsupported format version', async () => {
    const spy = createWarnSpy();
    const app = new App({ renderer: makeHeadlessRenderer(), logger: spy.logger });
    app.addPlugin(
      new AssetPlugin({ source: sourceFrom({ 'bad.rescene': JSON.stringify({ version: 999, entities: [] }) }) }),
    );
    app.addPlugin(new ScenePlugin());
    app.advanceFrame(0);

    const server = app.getResource(AssetServer)!;
    const handle = server.load<Scene>('bad.rescene');
    await server.settle();
    app.advanceFrame();

    expect(app.getResource(Scenes)!.get(handle)).toBeUndefined();
    expect(spy.warns.some((m) => m.includes('bad.rescene'))).toBe(true);
  });

  it('round-trips a Scene through the serializer', () => {
    const scene = new Scene(cubeScene());
    const codec = createSceneSerializer();
    expect(codec.deserialize(codec.serialize(scene)).data).toEqual(scene.data);
  });
});
