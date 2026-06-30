import { describe, expect, it } from 'bun:test';

import type { AssetSource } from '@retro-engine/assets';
import type { Entity } from '@retro-engine/ecs';
import { World } from '@retro-engine/ecs';

import {
  App,
  AssetPlugin,
  type Logger,
  Name,
  Parent,
  type SceneData,
  type SerializedEntity,
  ScenePlugin,
  serializePrefab,
} from '../index';
import { spawnScene } from './spawn';
import { makeHeadlessRenderer } from '../test-utils';

const emptySource: AssetSource = {
  read: (location) => Promise.reject(new Error(`missing: ${location}`)),
};

const transform = (x = 0): SceneData['entities'][number]['components'][number] => ({
  type: 'Transform',
  version: 1,
  data: { translation: [x, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
});

const named = (value: string): SceneData['entities'][number]['components'][number] => ({
  type: 'Name',
  version: 1,
  data: { value },
});

const findByName = (world: World, name: string): Entity | undefined => {
  for (const entity of world.entities()) {
    if (world.getComponent(entity, Name)?.value === name) return entity;
  }
  return undefined;
};

const byName = (data: SceneData, name: string): SerializedEntity | undefined => {
  for (const entity of data.entities) {
    for (const c of entity.components) {
      if (c.type === 'Name' && (c.data as { value: string }).value === name) return entity;
    }
  }
  return undefined;
};

const hasComponent = (entity: SerializedEntity, type: string): boolean =>
  entity.components.some((c) => c.type === type);

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

const buildApp = (logger?: Logger): App => {
  const app = new App(
    logger !== undefined
      ? { renderer: makeHeadlessRenderer(), logger }
      : { renderer: makeHeadlessRenderer() },
  );
  app.addPlugin(new AssetPlugin({ source: emptySource }));
  app.addPlugin(new ScenePlugin());
  app.advanceFrame(0);
  return app;
};

/** A Level (root) → Group → Child hierarchy spawned live into the app. */
const spawnHierarchy = (app: App): void => {
  const scene: SceneData = {
    version: 1,
    entities: [
      { id: 0, components: [transform(), named('Level')] },
      {
        id: 1,
        components: [transform(5), named('Group'), { type: 'Parent', version: 1, data: { entity: 0 } }],
      },
      {
        id: 2,
        components: [transform(1), named('Child'), { type: 'Parent', version: 1, data: { entity: 1 } }],
      },
    ],
  };
  spawnScene(app, scene);
  app.advanceFrame(16);
};

describe('serializePrefab — single-subtree capture', () => {
  it('captures only the subtree and drops the root Parent edge', () => {
    const app = buildApp();
    spawnHierarchy(app);
    const group = findByName(app.world, 'Group')!;

    const prefab = serializePrefab(app, group);

    // Only the subtree (Group + Child) is captured — the Level root is excluded.
    expect(byName(prefab, 'Level')).toBeUndefined();
    expect(byName(prefab, 'Group')).toBeDefined();
    expect(byName(prefab, 'Child')).toBeDefined();

    // The root's Parent (pointing at the excluded Level) is dropped; the Child's
    // Parent (inside the subtree) is kept.
    expect(hasComponent(byName(prefab, 'Group')!, 'Parent')).toBe(false);
    expect(hasComponent(byName(prefab, 'Child')!, 'Parent')).toBe(true);

    // A prefab is an object, not a world — it carries no App resources.
    expect(prefab.resources).toBeUndefined();
  });

  it('re-instantiates cleanly with the root as a top-level node (no orphan warnings)', () => {
    const { logger, warns } = createDevWarnSpy();
    const app = buildApp(logger);
    spawnHierarchy(app);
    const group = findByName(app.world, 'Group')!;

    const prefab = serializePrefab(app, group);
    warns.length = 0; // ignore anything from the source hierarchy

    spawnScene(app, prefab);
    app.advanceFrame(16);
    app.advanceFrame(16);

    // The reinstantiated subtree exists twice now (source + prefab copy), and the
    // copy's root has no dangling Parent → no "treating it as a root" warnings.
    let groups = 0;
    let children = 0;
    for (const entity of app.world.entities()) {
      const name = app.world.getComponent(entity, Name)?.value;
      if (name === 'Group') groups += 1;
      if (name === 'Child') children += 1;
    }
    expect(groups).toBe(2);
    expect(children).toBe(2);
    expect(warns.filter((w) => w.includes('treating'))).toHaveLength(0);

    // The source Group keeps its Parent (the Level); the prefab Group must not —
    // so at least one Group is now a parent-less root.
    const groupEntities: Entity[] = [];
    for (const entity of app.world.entities()) {
      if (app.world.getComponent(entity, Name)?.value === 'Group') groupEntities.push(entity);
    }
    expect(groupEntities.some((g) => app.world.getComponent(g, Parent) === undefined)).toBe(true);
  });
});
