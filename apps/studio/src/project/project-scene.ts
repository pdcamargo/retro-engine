import type { AssetGuid, AssetManifest, AssetSource } from '@retro-engine/assets';
import type { App } from '@retro-engine/engine';
import {
  applyCompletedLoads,
  AssetPlugin,
  AssetServer,
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
 * adopts the scanned manifest, loads the scene by GUID, settles, and spawns.
 * Returns false (so the caller can fall back) if the scene isn't found.
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
