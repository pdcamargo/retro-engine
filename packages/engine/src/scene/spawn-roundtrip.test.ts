import { describe, expect, it } from 'bun:test';

import { World, type ComponentType, type Entity } from '@retro-engine/ecs';
import { asAssetIndex, generateAssetGuid, makeHandle } from '@retro-engine/assets';
import { vec3 } from '@retro-engine/math';

import {
  App,
  AppTypeRegistry,
  Children,
  Commands,
  GlobalTransform,
  InheritedVisibility,
  type Logger,
  MaterialPlugin,
  Mesh,
  Mesh3d,
  Name,
  Parent,
  Transform,
  UnlitMaterial,
  UnlitMaterialPlugin,
  ViewVisibility,
  Visibility,
} from '../index';
import { deserializeScene } from './deserialize';
import { serializeScene } from './serialize';
import { spawnScene } from './spawn';
import type { SceneData } from './scene-data';
import { makeHeadlessRenderer, makeRenderingRenderer } from '../test-utils';

/** App wired with a real material type so `MeshMaterial3d<UnlitMaterial>` round-trips. */
const buildMaterialApp = (): { app: App; mat: MaterialPlugin<UnlitMaterial> } => {
  const app = new App({ renderer: makeRenderingRenderer() });
  app.addPlugin(new UnlitMaterialPlugin());
  const mat = new MaterialPlugin(UnlitMaterial);
  app.addPlugin(mat);
  return { app, mat };
};

const find = <T extends object>(world: World, type: ComponentType<T>): Entity => {
  for (const entity of world.entities()) {
    if (world.getComponent(entity, type) !== undefined) return entity;
  }
  throw new Error('no entity with the requested component');
};

const createSpyLogger = (): { logger: Logger; devWarns: string[] } => {
  const devWarns: string[] = [];
  const logger: Logger = {
    error: () => undefined,
    warn: () => undefined,
    info: () => undefined,
    debug: () => undefined,
    devWarn: (m) => {
      devWarns.push(m);
    },
    child: () => logger,
  };
  return { logger, devWarns };
};

describe('spawnScene — hook-firing round-trip', () => {
  it('respawns a real engine graph live: hierarchy, requires, derived recompute, handles', () => {
    const meshGuid = generateAssetGuid();
    const matGuid = generateAssetGuid();
    const meshHandle = makeHandle<Mesh>(asAssetIndex(7), meshGuid);
    const matHandle = makeHandle<UnlitMaterial>(asAssetIndex(9), matGuid);

    // Author a parent (Transform + Name) with one child (Transform + Mesh3d +
    // MeshMaterial3d + Visibility), parented through `withChildren` so the
    // source carries Parent / Children / the derived companions.
    const { app, mat } = buildMaterialApp();
    app.addSystem('startup', [Commands], (cmd) => {
      const parent = cmd.spawn(new Transform(vec3.create(10, 0, 0)), new Name('root'));
      parent.withChildren((p) => {
        p.spawn(
          new Transform(vec3.create(0, 5, 0)),
          new Mesh3d(meshHandle),
          new mat.MeshMaterial3d(matHandle),
          new Visibility('Visible'),
        );
      });
    });
    app.advanceFrame(0);

    // Serialize through the App's own registry, then prove it's plain JSON.
    const scene: SceneData = JSON.parse(JSON.stringify(serializeScene(app)));

    // Reload into a fresh App through the command-driven path. The resolver
    // hands back live handles that carry the original GUIDs (the store assigns
    // fresh indices on a real load; the GUID is the persistent identity).
    const { app: app2, mat: mat2 } = buildMaterialApp();
    const restoredMesh = makeHandle<Mesh>(asAssetIndex(50), meshGuid);
    const restoredMat = makeHandle<UnlitMaterial>(asAssetIndex(51), matGuid);
    const idMap = spawnScene(app2, scene, undefined, {
      resolveHandle: (_assetType, g) =>
        g === meshGuid ? restoredMesh : g === matGuid ? restoredMat : makeHandle(asAssetIndex(0)),
    });
    app2.advanceFrame(0);

    const parent = find(app2.world, Name);
    const child = find(app2.world, Mesh3d);

    // Hierarchy: the Parent edge is remapped to the freshly-spawned parent.
    expect(app2.world.getComponent(child, Parent)!.entity).toBe(parent);

    // Children was rebuilt from the Parent edge (never serialized) — the proof
    // the appendChild op fired, which a bare-world insert could not do.
    const children = app2.world.getComponent(parent, Children);
    expect(children).toBeDefined();
    expect(children!.entities).toContain(child);

    // Required Components were pulled in by Mesh3d / Visibility on insert.
    expect(app2.world.getComponent(child, GlobalTransform)).toBeDefined();
    expect(app2.world.getComponent(child, Visibility)).toBeDefined();
    expect(app2.world.getComponent(child, InheritedVisibility)).toBeDefined();
    expect(app2.world.getComponent(child, ViewVisibility)).toBeDefined();

    // GlobalTransform was recomputed by propagation: child world = parent world
    // (10,0,0) composed with child local (0,5,0) → (10,5,0). Not identity, not
    // the child-local-alone — so it came from propagation, not the scene data
    // (which never carries GlobalTransform).
    const childGlobal = app2.world.getComponent(child, GlobalTransform)!;
    expect(childGlobal.matrix[12]).toBeCloseTo(10, 5);
    expect(childGlobal.matrix[13]).toBeCloseTo(5, 5);
    expect(childGlobal.matrix[14]).toBeCloseTo(0, 5);

    // Authored Transform survived intact.
    const childLocal = app2.world.getComponent(child, Transform)!;
    expect(Array.from(childLocal.translation)).toEqual([0, 5, 0]);

    // Visibility mode survived the enum round-trip.
    expect(app2.world.getComponent(child, Visibility)!.mode).toBe('Visible');

    // Handles persisted by GUID and resolved to live, index-bearing handles —
    // the material decoded onto the App's per-type MeshMaterial3d subclass.
    expect(app2.world.getComponent(child, Mesh3d)!.handle.guid).toBe(meshGuid);
    expect(app2.world.getComponent(child, mat2.MeshMaterial3d)!.handle.guid).toBe(matGuid);

    // The returned remap covers exactly the scene's entities.
    expect(idMap.size).toBe(scene.entities.length);
  });
});

describe('spawnScene — bare-world contrast and edge cases', () => {
  it('bare deserialize carries the Parent edge but does not rebuild Children', () => {
    const { app } = buildMaterialApp();
    const registry = app.getResource(AppTypeRegistry)!.registry;
    const scene: SceneData = {
      version: 1,
      entities: [
        { id: 0, components: [{ type: 'Name', version: 1, data: { value: 'root' } }] },
        { id: 1, components: [{ type: 'Parent', version: 1, data: { entity: 0 } }] },
      ],
    };
    const world = new World();
    const idMap = deserializeScene(scene, world, registry);
    const parent = idMap.get(0)!;
    const child = idMap.get(1)!;

    expect(world.getComponent(child, Parent)!.entity).toBe(parent);
    // No appendChild op ran in the bare path, so the reciprocal stays unbuilt —
    // this is exactly the gap spawnScene closes.
    expect(world.getComponent(parent, Children)).toBeUndefined();
  });

  it('leaves a child a root when its Parent edge dangles (no throw)', () => {
    const spy = createSpyLogger();
    const app = new App({ renderer: makeHeadlessRenderer(), logger: spy.logger });
    const scene: SceneData = {
      version: 1,
      entities: [
        {
          id: 0,
          components: [
            { type: 'Transform', version: 1, data: { translation: [1, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] } },
            { type: 'Parent', version: 1, data: { entity: 999 } },
          ],
        },
      ],
    };
    const idMap = spawnScene(app, scene);
    const child = idMap.get(0)!;
    expect(app.world.getComponent(child, Parent)).toBeUndefined();
  });

  it('throws via the default resolver when a referenced asset is absent from its store', () => {
    // No resolveHandle passed: handles resolve by GUID against the App's asset
    // stores. The store exists (MeshPlugin registered it) but holds no asset for
    // this GUID, so resolution fails loudly rather than silently dropping it.
    const app = new App({ renderer: makeHeadlessRenderer() });
    const scene: SceneData = {
      version: 1,
      entities: [{ id: 0, components: [{ type: 'Mesh3d', version: 1, data: { handle: 'guid-x' } }] }],
    };
    expect(() => spawnScene(app, scene)).toThrow(/not present in its store/);
  });
});
