// Integration test for the hierarchy edit commands as the studio drives them:
// spawn-under-parent, subtree duplicate, and recursive delete — plus their undo.
// These compose serializePrefab / spawnScene / despawnSubtree with the editor
// History, which the offline studio can't exercise, so a headless App stands in.
import { describe, expect, test } from 'bun:test';

import type { AssetSource } from '@retro-engine/assets';
import type { Entity } from '@retro-engine/ecs';
import {
  App,
  AppTypeRegistry,
  AssetPlugin,
  Children,
  Name,
  Parent,
  type SceneData,
  ScenePlugin,
  spawnScene,
} from '@retro-engine/engine';
import { History } from '@retro-engine/editor-sdk';
import { type CommandContext, createDefaultRegistry, type StudioEditorState } from '@retro-engine/editor-mcp';
import { createWebGPURenderer } from '@retro-engine/renderer-webgpu';

const emptySource: AssetSource = {
  read: (location) => Promise.reject(new Error(`missing: ${location}`)),
};

const registry = createDefaultRegistry();

/** A headless App with a Level → Group → Child hierarchy spawned live. */
const buildApp = (): App => {
  const app = new App({ renderer: createWebGPURenderer({} as HTMLCanvasElement) });
  app.addPlugin(new AssetPlugin({ source: emptySource }));
  app.addPlugin(new ScenePlugin());
  // No advanceFrame: the WebGPU renderer isn't initialized headlessly, and these
  // commands need only the live world — spawnScene flushes its own commands.
  const scene: SceneData = {
    version: 1,
    entities: [
      { id: 0, components: [{ type: 'Transform', version: 1, data: {} }, { type: 'Name', version: 1, data: { value: 'Level' } }] },
      {
        id: 1,
        components: [
          { type: 'Transform', version: 1, data: {} },
          { type: 'Name', version: 1, data: { value: 'Group' } },
          { type: 'Parent', version: 1, data: { entity: 0 } },
        ],
      },
      {
        id: 2,
        components: [
          { type: 'Transform', version: 1, data: {} },
          { type: 'Name', version: 1, data: { value: 'Child' } },
          { type: 'Parent', version: 1, data: { entity: 1 } },
        ],
      },
    ],
  };
  spawnScene(app, scene);
  return app;
};

const makeCtx = (app: App): CommandContext => {
  const registry2 = app.getResource(AppTypeRegistry)!.registry;
  const history = new History({ world: app.world, registry: registry2 }, { capacity: 100 });
  const state: StudioEditorState = {
    selectedEntity: null,
    debugMode: false,
    dirty: false,
    playing: false,
    paused: false,
    viewMode: '3d',
  };
  return { app, world: app.world, registry: registry2, history, state, assetServer: undefined } as unknown as CommandContext;
};

const run = (ctx: CommandContext, name: string, args: unknown): unknown => {
  const def = registry.get(name);
  if (def === undefined) throw new Error(`no command ${name}`);
  return def.handler(ctx, args);
};

const findByName = (app: App, name: string): Entity | undefined => {
  for (const e of app.world.entities()) if (app.world.getComponent(e, Name)?.value === name) return e;
  return undefined;
};

const countNamed = (app: App, name: string): number => {
  let n = 0;
  for (const e of app.world.entities()) if (app.world.getComponent(e, Name)?.value === name) n += 1;
  return n;
};

const childrenOf = (app: App, e: Entity): Entity[] =>
  (app.world.getComponent(e, Children) as { entities: Entity[] } | undefined)?.entities ?? [];

describe('hierarchy edit commands', () => {
  test('entity.spawn parents the new entity and undo detaches it', () => {
    const app = buildApp();
    const ctx = makeCtx(app);
    const level = findByName(app, 'Level')!;

    const result = run(ctx, 'entity.spawn', { name: 'Marker', parent: level, components: [{ type: 'Transform' }] }) as {
      entity: Entity;
    };
    const marker = result.entity;
    expect(app.world.hasEntity(marker)).toBe(true);
    expect((app.world.getComponent(marker, Parent) as { entity: Entity }).entity).toBe(level);
    expect(childrenOf(app, level)).toContain(marker);
    expect(ctx.state.selectedEntity).toBe(marker);

    ctx.history.undo();
    expect(app.world.hasEntity(marker)).toBe(false);
    expect(childrenOf(app, level)).not.toContain(marker);
  });

  test('entity.duplicate deep-copies the subtree under the same parent, then undo/redo', () => {
    const app = buildApp();
    const ctx = makeCtx(app);
    const level = findByName(app, 'Level')!;
    const group = findByName(app, 'Group')!;

    const result = run(ctx, 'entity.duplicate', { entity: group }) as { entity: Entity; name: string };
    expect(result.name).toBe('Group (1)');
    expect(countNamed(app, 'Group')).toBe(1); // source name unchanged
    expect(countNamed(app, 'Group (1)')).toBe(1);
    expect(countNamed(app, 'Child')).toBe(2); // the copy brought its own Child

    const copy = result.entity;
    expect(copy).not.toBe(group);
    expect((app.world.getComponent(copy, Parent) as { entity: Entity }).entity).toBe(level);
    expect(ctx.state.selectedEntity).toBe(copy);
    // Source is untouched.
    expect((app.world.getComponent(group, Parent) as { entity: Entity }).entity).toBe(level);

    ctx.history.undo();
    expect(app.world.hasEntity(copy)).toBe(false);
    expect(countNamed(app, 'Child')).toBe(1);
    expect(ctx.state.selectedEntity).toBe(group);

    ctx.history.redo();
    expect(countNamed(app, 'Group (1)')).toBe(1);
    expect(countNamed(app, 'Child')).toBe(2);
  });

  test('entity.despawnRecursive removes the subtree and undo restores it with original ids', () => {
    const app = buildApp();
    const ctx = makeCtx(app);
    const level = findByName(app, 'Level')!;
    const group = findByName(app, 'Group')!;
    const child = findByName(app, 'Child')!;
    ctx.state.selectedEntity = child;

    const result = run(ctx, 'entity.despawnRecursive', { entity: group }) as { despawned: number };
    expect(result.despawned).toBe(2);
    expect(app.world.hasEntity(group)).toBe(false);
    expect(app.world.hasEntity(child)).toBe(false);
    expect(app.world.hasEntity(level)).toBe(true);
    expect(childrenOf(app, level)).not.toContain(group);
    expect(ctx.state.selectedEntity).toBeNull(); // selection was inside the subtree

    ctx.history.undo();
    // Same ids come back, the Parent edges and the reciprocal Children are rebuilt.
    expect(app.world.hasEntity(group)).toBe(true);
    expect(app.world.hasEntity(child)).toBe(true);
    expect((app.world.getComponent(group, Parent) as { entity: Entity }).entity).toBe(level);
    expect((app.world.getComponent(child, Parent) as { entity: Entity }).entity).toBe(group);
    expect(childrenOf(app, level)).toContain(group);
    expect(childrenOf(app, group)).toContain(child);
  });
});
