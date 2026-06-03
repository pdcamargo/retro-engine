import { describe, expect, it } from 'bun:test';

import type { AssetGuid } from '@retro-engine/assets';
import { World, type ComponentType, type Entity } from '@retro-engine/ecs';

import {
  App,
  Light3dPlugin,
  MaterialPlugin,
  Mesh,
  Mesh3d,
  Meshes,
  PrepassPlugin,
  StandardMaterial,
  StandardMaterialPlugin,
  Transform,
} from '../index';
import { serializeScene } from './serialize';
import { spawnScene } from './spawn';
import type { SceneData } from './scene-data';
import { makeCapturingRenderer, makeStubCanvas } from '../test-utils';

const buildApp = (): { app: App; pbr: MaterialPlugin<StandardMaterial> } => {
  const { renderer } = makeCapturingRenderer();
  const app = new App({ renderer, canvas: makeStubCanvas() });
  app.addPlugin(new StandardMaterialPlugin());
  const pbr = new MaterialPlugin(StandardMaterial);
  app.addPlugin(pbr);
  app.addPlugin(new Light3dPlugin());
  app.addPlugin(new PrepassPlugin());
  return { app, pbr };
};

const find = <T extends object>(world: World, type: ComponentType<T>): Entity => {
  for (const entity of world.entities()) {
    if (world.getComponent(entity, type) !== undefined) return entity;
  }
  throw new Error('no entity with the requested component');
};

/**
 * Serialize a one-entity scene (mesh + per-type material, both referenced by the
 * GUID their store minted on `add`) and return the JSON plus those GUIDs. Built
 * by writing components straight into the world — no frame, no GPU upload.
 */
const buildSceneJson = (): { scene: SceneData; meshGuid: AssetGuid; matGuid: AssetGuid } => {
  const { app, pbr } = buildApp();
  const meshHandle = app.getResource(Meshes)!.add(new Mesh({ label: 'm' }));
  const matHandle = app.getResource(pbr.Materials)!.add(new StandardMaterial());

  const e = app.world.spawn();
  app.world
    .entity(e)
    .insert(new Mesh3d(meshHandle), new pbr.MeshMaterial3d(matHandle), new Transform());

  const scene = JSON.parse(JSON.stringify(serializeScene(app))) as SceneData;
  return { scene, meshGuid: meshHandle.guid!, matGuid: matHandle.guid! };
};

describe('scene round-trip — automatic GUID handle resolution (3D)', () => {
  it('restores mesh + material handles with no resolveHandle when the assets are in their stores', () => {
    const { scene, meshGuid, matGuid } = buildSceneJson();

    // A fresh App that re-establishes the same assets under the same GUIDs —
    // what a manifest-backed load does. The values differ by identity from the
    // source App's, proving resolution routes through *this* App's stores.
    const { app, pbr } = buildApp();
    const meshValue = new Mesh({ label: 'm' });
    const matValue = new StandardMaterial();
    const reMesh = app.getResource(Meshes)!.add(meshValue, meshGuid);
    const reMat = app.getResource(pbr.Materials)!.add(matValue, matGuid);

    // No resolveHandle passed — the default resolver reads the App's AssetStores.
    spawnScene(app, scene);

    const child = find(app.world, Mesh3d);
    const m3d = app.world.getComponent(child, Mesh3d)!;
    expect(m3d.handle.guid).toBe(meshGuid);
    expect(m3d.handle.index).toBe(reMesh.index);
    expect(app.getResource(Meshes)!.get(m3d.handle)).toBe(meshValue);

    const mm = app.world.getComponent(child, pbr.MeshMaterial3d)!;
    expect(mm.handle.guid).toBe(matGuid);
    expect(mm.handle.index).toBe(reMat.index);
    expect(app.getResource(pbr.Materials)!.get(mm.handle)).toBe(matValue);
  });

  it('throws when a referenced asset is absent from its store', () => {
    const { scene } = buildSceneJson();

    // A fresh App with the plugins (so the stores exist and the assetType is
    // registered) but without the referenced assets added.
    const { app } = buildApp();
    expect(() => spawnScene(app, scene)).toThrow(/not present in its store/);
  });
});
