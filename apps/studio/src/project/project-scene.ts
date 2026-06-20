import type { AssetGuid, AssetManifest, AssetSource } from '@retro-engine/assets';
import type { App } from '@retro-engine/engine';
import {
  applyCompletedLoads,
  ASSET_TYPE,
  AssetPlugin,
  AssetServer,
  createHdrImporter,
  createMeshImporter,
  Images,
  Meshes,
  registerAssetStore,
  registerMaterialLoaders,
  scanMetaManifest,
  ScenePlugin,
  Scenes,
  spawnScene,
} from '@retro-engine/engine';

/** Rebuild the project's asset manifest by reading its `.meta` sidecars off the source. */
export const scanProjectManifest = async (
  source: AssetSource,
  files: readonly string[],
): Promise<AssetManifest> => {
  const metas = files.filter((f) => f.endsWith('.meta'));
  const entries = await Promise.all(metas.map(async (loc) => [loc, await source.read(loc)] as const));
  return scanMetaManifest(entries);
};

/**
 * Load the project's startup scene from disk and spawn it into the world — the
 * host-backed `SceneSource` the studio uses instead of the in-memory showcase
 * when a project is open. Adds the asset + scene plugins over the project source,
 * adopts the scanned manifest, loads the scene by GUID, settles, and spawns — the
 * scene's referenced assets then stream in on demand (ADR-0100), not as a bulk
 * preload. Returns false (so the caller can fall back) if the scene isn't found.
 */
export const loadProjectScene = async (
  app: App,
  source: AssetSource,
  manifest: AssetManifest,
  startupSceneGuid: string,
): Promise<boolean> => {
  app.addPlugin(new AssetPlugin({ source }));
  app.addPlugin(new ScenePlugin());

  const server = app.getResource(AssetServer)!;
  // Project file loaders the engine has no default for: a `.rmesh` decodes to a
  // Mesh in the project's Meshes store, so a scene that references a mesh by GUID
  // streams it in through the on-demand resolver. (Image/material loaders join
  // here as those project asset types are exercised.)
  let meshes = app.getResource(Meshes);
  if (meshes === undefined) {
    meshes = new Meshes();
    app.insertResource(meshes);
    registerAssetStore(app, ASSET_TYPE.mesh, meshes);
  }
  server.registerLoader('rmesh', meshes, createMeshImporter());

  // `.hdr` Radiance HDRIs decode to a linear equirect Image; the skybox /
  // environment systems convert the equirect to a cube on demand.
  const images = app.getResource(Images);
  if (images !== undefined) {
    server.registerLoader('hdr', images, createHdrImporter());
  }

  // Kind-routed `.remat` loaders for every registered material type, so a scene
  // entity's `MeshMaterial3d<M>` reference resolves into the right per-type store
  // on demand. Re-run if a project registers its own material types.
  registerMaterialLoaders(app);

  server.setManifest(manifest);
  server.loadByGuid(startupSceneGuid as AssetGuid);
  await server.settle();
  applyCompletedLoads(server);

  const scenes = app.getResource(Scenes)!;
  const handle = scenes.handleByGuid(startupSceneGuid as AssetGuid);
  if (handle === undefined) return false;
  const scene = scenes.get(handle);
  if (scene === undefined) return false;

  spawnScene(app, scene.data);
  return true;
};
