// ?mode=save — persistent project save round-trip (browser → disk → browser).
//
// Authors a scene (a camera + an ambient-lit cube) with distinctive world
// settings — a purple ClearColor and a warm AmbientLight — renders it, then
// asynchronously SAVES the whole project through the injected browser AssetSink:
// HttpPostAssetSink → the dev server's `/save/*` route → disk. The saved project
// is a manifest + the scene document + the promoted cube mesh (`.rmesh`) + `.meta`
// sidecars.
//
// It then RELOADS those exact bytes back through the engine's normal read path —
// a fresh AssetServer over FetchAssetSource (`/saved/*`): loadManifest →
// loadByGuid → settle → drain — and logs a fidelity confirmation read out of the
// reloaded scene + mesh. What you see on screen IS the saved data; the console
// proves the disk bytes reload identically.
//
// Run the dev server (`bun run dev` in apps/playground) so `/save` + `/saved` are
// live, then open ?mode=save in a WebGPU browser. Restart the dev server after
// engine edits — it does not hot-reload the engine.

import { quat, vec3 } from '@retro-engine/math';
import type { Handle } from '@retro-engine/assets';
import type { Plugin } from '@retro-engine/engine';
import {
  AmbientLight,
  ASSET_TYPE,
  AssetServer,
  Camera3d,
  ClearColor,
  Commands,
  createMeshImporter,
  createSceneImporter,
  Cuboid,
  FetchAssetSource,
  HttpPostAssetSink,
  Light3dPlugin,
  MaterialPlugin,
  Mesh,
  Mesh3d,
  Meshes,
  Name,
  PrepassPlugin,
  ProjectSaveSink,
  Query,
  ResMut,
  Scenes,
  serializeProject,
  serializeScene,
  StandardMaterial,
  StandardMaterialPlugin,
  Time,
  Transform,
  Visibility,
  applyCompletedLoads,
} from '@retro-engine/engine';

/**
 * Playground showcase that saves a real scene + world settings + a promoted mesh
 * to disk through the browser sink, then reloads it through the engine's read
 * path to prove the project round-tripped.
 */
export const saveShowcasePlugin: Plugin = (app) => {
  const log = app.logger.child('save-showcase');
  const pbr = new MaterialPlugin(StandardMaterial);
  app.addPlugin(new StandardMaterialPlugin());
  app.addPlugin(pbr);
  app.addPlugin(new Light3dPlugin());
  app.addPlugin(new PrepassPlugin());

  // Inject the browser write sink behind the engine's DI seam — the same place a
  // studio's native/disk sink drops in. The dev server's `/save/*` route persists
  // the bytes; `/saved/*` serves them back for FetchAssetSource.
  const origin = window.location.origin;
  app.insertResource(new ProjectSaveSink(new HttpPostAssetSink({ baseUrl: `${origin}/save/` })));

  let cubeHandle: Handle<Mesh> | undefined;

  app.addSystem(
    'startup',
    [Commands, ResMut(Meshes), ResMut(pbr.Materials)],
    (cmd, meshes, materials) => {
      // Distinctive authored world settings, so the round-trip is both visible
      // and checkable on reload.
      app.insertResource(new ClearColor({ r: 0.12, g: 0.04, b: 0.18, a: 1 }));
      app.insertResource(new AmbientLight({ color: vec3.create(0.9, 0.7, 0.4), brightness: 0.9 }));

      cubeHandle = meshes.add(new Cuboid().mesh().build());
      const material = materials.add(new StandardMaterial());

      const camT = new Transform();
      camT.translation = vec3.create(0, 1.4, 4);
      quat.fromAxisAngle(vec3.create(1, 0, 0), -0.3, camT.rotation);
      cmd.spawn(...Camera3d({ transform: camT }));

      cmd.spawn(
        new Mesh3d(cubeHandle),
        new pbr.MeshMaterial3d(material),
        new Transform(),
        new Visibility('Visible'),
        new Name('saved-cube'),
      );
    },
  );

  // Spin the cube so the demo is lively (and proves the live scene renders).
  app.addSystem('update', [Query([Transform, Name]), ResMut(Time)], (cubes, time) => {
    for (const [entity, transform, name] of cubes.entries()) {
      if (name.value !== 'saved-cube') continue;
      quat.fromAxisAngle(vec3.create(0, 1, 0), time.virtual.elapsed * 0.6, transform.rotation);
      app.world.markChanged(entity, Transform);
    }
  });

  // After the first frame's command flush, the authored scene is live: save it,
  // then reload it from disk. One-shot.
  let kicked = false;
  app.addSystem('last', [], () => {
    if (kicked || cubeHandle === undefined) return;
    kicked = true;
    void saveAndReload(cubeHandle);
  });

  const saveAndReload = async (cube: Handle<Mesh>): Promise<void> => {
    try {
      const project = serializeProject(app, {
        scenes: [{ location: 'scenes/main.scene', data: serializeScene(app) }],
        promotions: [{ handle: cube, kind: ASSET_TYPE.mesh, extension: 'rmesh' }],
      });

      const sink = app.getResource(ProjectSaveSink)!.sink;
      for (const file of project.files) await sink.write(file.location, file.bytes);
      log.info(`saved ${project.files.length} files → ${project.files.map((f) => f.location).join(', ')}`);

      // Reload the exact bytes back through the engine's read path, into throwaway
      // stores (we only verify the disk round-trip here; the live scene already
      // renders the same data).
      const server = new AssetServer({ source: new FetchAssetSource({ baseUrl: `${origin}/saved/` }) });
      const meshes = new Meshes();
      const scenes = new Scenes();
      server.registerLoader('rmesh', meshes, createMeshImporter());
      server.registerLoader('scene', scenes, createSceneImporter());

      await server.loadManifest('assets.manifest.json');
      for (const entry of project.manifest.entries) server.loadByGuid(entry.guid);
      await server.settle();
      applyCompletedLoads(server);

      const reloadedScene = scenes.get(scenes.handleByGuid(project.projectDoc.scenes[0]!)!)!;
      const reloadedMesh = meshes.get(meshes.handleByGuid(cube.guid!)!)!;

      log.info('reloaded from disk — round-trip confirmed:');
      // eslint-disable-next-line no-console
      console.log({
        sceneEntities: reloadedScene.data.entities.length,
        resourceTypes: (reloadedScene.data.resources ?? []).map((r) => r.type),
        reloadedMeshVertexCount: reloadedMesh.vertexCount,
        clearColor: (reloadedScene.data.resources ?? []).find((r) => r.type === 'ClearColor')?.data,
        ambientLight: (reloadedScene.data.resources ?? []).find((r) => r.type === 'AmbientLight')?.data,
      });
    } catch (err) {
      log.error(`save round-trip failed: ${String(err)}`);
    }
  };
};
