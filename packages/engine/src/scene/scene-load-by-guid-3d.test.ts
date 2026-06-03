import { describe, expect, it } from 'bun:test';

import type { AssetSource } from '@retro-engine/assets';
import { MANIFEST_FORMAT_VERSION, parseAssetManifest } from '@retro-engine/assets';
import { World, type ComponentType, type Entity } from '@retro-engine/ecs';

import {
  App,
  AssetPlugin,
  AssetServer,
  Light3dPlugin,
  MaterialPlugin,
  Mesh,
  Mesh3d,
  Meshes,
  PrepassPlugin,
  StandardMaterial,
  StandardMaterialPlugin,
  Transform,
  applyCompletedLoads,
} from '../index';
import { serializeScene } from './serialize';
import { spawnScene } from './spawn';
import type { SceneData } from './scene-data';
import { makeCapturingRenderer, makeStubCanvas } from '../test-utils';

const buildApp = (source?: AssetSource): { app: App; pbr: MaterialPlugin<StandardMaterial> } => {
  const { renderer } = makeCapturingRenderer();
  const app = new App({ renderer, canvas: makeStubCanvas() });
  app.addPlugin(new StandardMaterialPlugin());
  const pbr = new MaterialPlugin(StandardMaterial);
  app.addPlugin(pbr);
  app.addPlugin(new Light3dPlugin());
  app.addPlugin(new PrepassPlugin());
  if (source !== undefined) app.addPlugin(new AssetPlugin({ source }));
  return { app, pbr };
};

const find = <T extends object>(world: World, type: ComponentType<T>): Entity => {
  for (const entity of world.entities()) {
    if (world.getComponent(entity, type) !== undefined) return entity;
  }
  throw new Error('no entity with the requested component');
};

describe('scene load by GUID — fresh App over a stubbed AssetSource (3D)', () => {
  it('loads a scene’s referenced assets by GUID and resolves handles with no resolveHandle', async () => {
    // App #1 — author a one-entity scene and serialize it. The mesh and material
    // are referenced by the GUID their store minted on `add`.
    const src = buildApp();
    const meshHandle = src.app.getResource(Meshes)!.add(new Mesh({ label: 'm' }));
    const matHandle = src.app.getResource(src.pbr.Materials)!.add(new StandardMaterial());
    const e = src.app.world.spawn();
    src.app.world
      .entity(e)
      .insert(new Mesh3d(meshHandle), new src.pbr.MeshMaterial3d(matHandle), new Transform());
    const scene = JSON.parse(JSON.stringify(serializeScene(src.app))) as SceneData;
    const meshGuid = meshHandle.guid!;
    const matGuid = matHandle.guid!;

    // A manifest mapping those GUIDs to stub locations, and a source holding the
    // bytes for each. The bytes are opaque — the stub importers ignore them.
    const meshLoc = 'meshes/m.mesh';
    const matLoc = 'materials/m.smat';
    const manifest = parseAssetManifest(
      JSON.stringify({
        version: MANIFEST_FORMAT_VERSION,
        entries: [
          { guid: meshGuid, location: meshLoc, kind: 'Mesh' },
          { guid: matGuid, location: matLoc, kind: 'StandardMaterial' },
        ],
      }),
    );
    const source: AssetSource = {
      read: (location) =>
        location === meshLoc || location === matLoc
          ? Promise.resolve(new TextEncoder().encode('x'))
          : Promise.reject(new Error(`missing: ${location}`)),
    };

    // App #2 — fresh, no shared stores. Stub loaders return fresh values whose
    // identity differs from App #1's, proving resolution routes through *this*
    // App's stores. The loaders must target the same store instances the App
    // registered in AssetStores, or handleFor cannot find the loaded asset.
    const { app, pbr } = buildApp(source);
    const server = app.getResource(AssetServer)!;
    const meshes = app.getResource(Meshes)!;
    const materials = app.getResource(pbr.Materials)!;
    const loadedMesh = new Mesh({ label: 'loaded' });
    const loadedMat = new StandardMaterial();
    server.registerLoader('mesh', meshes, () => loadedMesh);
    server.registerLoader('smat', materials, () => loadedMat);

    // Read half: manifest → loadByGuid each → settle → drain → spawn.
    server.setManifest(manifest);
    for (const entry of manifest.entries.values()) server.loadByGuid(entry.guid);
    await server.settle();
    applyCompletedLoads(server);

    // No resolveHandle passed — the default resolver reads the App's AssetStores,
    // which the load above populated by GUID.
    spawnScene(app, scene);

    const child = find(app.world, Mesh3d);
    const m3d = app.world.getComponent(child, Mesh3d)!;
    expect(m3d.handle.guid).toBe(meshGuid);
    expect(meshes.get(m3d.handle)).toBe(loadedMesh);

    const mm = app.world.getComponent(child, pbr.MeshMaterial3d)!;
    expect(mm.handle.guid).toBe(matGuid);
    expect(materials.get(mm.handle)).toBe(loadedMat);
  });
});
