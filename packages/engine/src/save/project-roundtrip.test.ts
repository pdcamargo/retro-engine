import { describe, expect, it } from 'bun:test';

import { parseAssetManifest } from '@retro-engine/assets';
import { World, type ComponentType, type Entity } from '@retro-engine/ecs';
import { vec3 } from '@retro-engine/math';

import {
  AmbientLight,
  App,
  ASSET_TYPE,
  AssetPlugin,
  AssetServer,
  ClearColor,
  Children,
  Light3dPlugin,
  MaterialPlugin,
  MeshAttribute,
  Mesh,
  Mesh3d,
  Meshes,
  Name,
  Parent,
  PrepassPlugin,
  Scenes,
  ScenePlugin,
  StandardMaterial,
  StandardMaterialPlugin,
  Transform,
  applyCompletedLoads,
  createMeshImporter,
  serializeProject,
  u16Indices,
} from '../index';
import { serializeScene } from '../scene/serialize';
import { spawnScene } from '../scene/spawn';
import { MemoryAssetSink, MemoryAssetSource } from '../asset/memory-sink';
import { makeCapturingRenderer, makeStubCanvas } from '../test-utils';

const buildApp = (source?: MemoryAssetSource): App => {
  const { renderer } = makeCapturingRenderer();
  const app = new App({ renderer, canvas: makeStubCanvas() });
  app.addPlugin(new StandardMaterialPlugin());
  app.addPlugin(new MaterialPlugin(StandardMaterial));
  app.addPlugin(new Light3dPlugin());
  app.addPlugin(new PrepassPlugin());
  if (source !== undefined) {
    app.addPlugin(new AssetPlugin({ source }));
    app.addPlugin(new ScenePlugin());
  }
  return app;
};

const buildCube = (): Mesh =>
  new Mesh({ label: 'cube' })
    .insertAttribute(MeshAttribute.POSITION, new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]))
    .insertAttribute(MeshAttribute.NORMAL, new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]))
    .setIndices(u16Indices([0, 1, 2, 1, 3, 2]));

const find = <T extends object>(world: World, type: ComponentType<T>): Entity => {
  for (const entity of world.entities()) {
    if (world.getComponent(entity, type) !== undefined) return entity;
  }
  throw new Error('no entity with the requested component');
};

const text = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

describe('project save → load round-trip (in-memory sink, real read path)', () => {
  it('round-trips entities, hierarchy, a promoted mesh by GUID, and authored resources', async () => {
    // --- App #1: author a graph + resources, then serialize a whole project. ---
    const app1 = buildApp();
    app1.insertResource(new ClearColor({ r: 0.1, g: 0.2, b: 0.3, a: 1 }));
    app1.insertResource(new AmbientLight({ color: vec3.create(0.5, 0.6, 0.7), brightness: 0.25 }));

    const meshHandle = app1.getResource(Meshes)!.add(buildCube());
    const root = app1.world.spawn(new Name('root'), new Transform());
    app1.world.spawn(new Mesh3d(meshHandle), new Transform(), new Name('child'), new Parent(root));

    const sceneData = serializeScene(app1); // carries ClearColor + AmbientLight + Shadow3dSettings
    const saved = serializeProject(app1, {
      scenes: [{ location: 'scenes/main.scene', data: sceneData }],
      promotions: [{ handle: meshHandle, kind: ASSET_TYPE.mesh, extension: 'rmesh' }],
    });

    // Pure-data invariant: the baked manifest is exactly what parse reads back.
    const manifestText = text(saved.files.find((f) => f.location === 'assets.manifest.json')!.bytes);
    expect(parseAssetManifest(manifestText).entries.size).toBe(2); // the mesh + the scene

    // --- Write every file through an in-memory sink (no real I/O). ---
    const sink = new MemoryAssetSink();
    for (const file of saved.files) await sink.write(file.location, file.bytes);

    // --- App #2: fresh App over a source reading those same bytes. ---
    const app2 = buildApp(new MemoryAssetSource(sink.files));
    const server = app2.getResource(AssetServer)!;
    // `.scene` importer comes from ScenePlugin; register the `.rmesh` importer.
    server.registerLoader('rmesh', app2.getResource(Meshes)!, createMeshImporter());

    // Read half: manifest-only (never the .meta sidecars) → loadByGuid each →
    // settle → drain.
    await server.loadManifest('assets.manifest.json');
    const manifest = parseAssetManifest(text(sink.files.get('assets.manifest.json')!));
    for (const entry of manifest.entries.values()) server.loadByGuid(entry.guid);
    await server.settle();
    applyCompletedLoads(server);

    // Fetch the loaded scene asset by its GUID from the project doc, then spawn it.
    const projectDoc = JSON.parse(text(sink.files.get('project.json')!)) as { scenes: string[] };
    const scenes = app2.getResource(Scenes)!;
    const loadedScene = scenes.get(scenes.handleByGuid(projectDoc.scenes[0]! as never)!)!;
    spawnScene(app2, loadedScene.data);

    // --- Fidelity: the promoted mesh round-tripped by GUID, bytes intact. ---
    const child = find(app2.world, Mesh3d);
    const m3d = app2.world.getComponent(child, Mesh3d)!;
    expect(m3d.handle.guid).toBe(meshHandle.guid);
    const loadedMesh = app2.getResource(Meshes)!.get(m3d.handle)!;
    expect(Array.from(loadedMesh.getAttribute(MeshAttribute.POSITION)!.data)).toEqual([
      0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0,
    ]);
    expect(loadedMesh.indices?.kind).toBe('u16');

    // --- Fidelity: hierarchy rebuilt from the serialized Parent edge. ---
    const parent = app2.world.getComponent(child, Parent)!.entity;
    expect(app2.world.getComponent(parent, Name)!.value).toBe('root');
    expect(app2.world.getComponent(parent, Children)!.entities).toContain(child);

    // --- Fidelity: authored resources restored. ---
    expect(app2.getResource(ClearColor)!.color).toEqual({ r: 0.1, g: 0.2, b: 0.3, a: 1 });
    const ambient = app2.getResource(AmbientLight)!;
    expect(ambient.brightness).toBeCloseTo(0.25, 5);
    expect(Array.from(ambient.color)).toEqual([
      Math.fround(0.5),
      Math.fround(0.6),
      Math.fround(0.7),
    ]);
  });
});
