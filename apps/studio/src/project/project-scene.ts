import type { AssetGuid, AssetManifest, AssetSource } from '@retro-engine/assets';
import type { App, MaterialPlugin, StandardMaterial } from '@retro-engine/engine';
import {
  AppBundleRegistry,
  applyCompletedLoads,
  ASSET_TYPE,
  AssetPlugin,
  AssetServer,
  BUNDLE_ASSET_KIND,
  BundlePlugin,
  createHdrImporter,
  createMeshImporter,
  deserializeBundle,
  Images,
  Meshes,
  registerAssetStore,
  registerMaterialLoaders,
  scanMetaManifest,
  ScenePlugin,
  Scenes,
  spawnScene,
} from '@retro-engine/engine';
import { GltfPlugin, Gltfs } from '@retro-engine/gltf';

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
 * Read every `.rebundle` asset listed in `manifest` off `source` and register it
 * in the App's {@link AppBundleRegistry}, so user-authored bundles appear in the
 * Add-Component palette next to code-defined ones. Bundles are small and all
 * needed up front (the palette lists them eagerly), so — unlike scene-referenced
 * assets — they are not streamed on demand. Returns how many were registered.
 */
export const loadProjectBundles = async (
  app: App,
  source: AssetSource,
  manifest: AssetManifest,
): Promise<number> => {
  const registry = app.getResource(AppBundleRegistry);
  if (registry === undefined) return 0;
  let count = 0;
  for (const entry of manifest.entries.values()) {
    if (entry.kind !== BUNDLE_ASSET_KIND) continue;
    try {
      const bytes = await source.read(entry.location);
      const fallback = entry.location.split('/').pop()?.replace(/\.rebundle$/, '') ?? entry.location;
      registry.register(deserializeBundle(bytes, fallback));
      count += 1;
    } catch (err) {
      console.warn(`[studio] failed to load bundle ${entry.location}`, err);
    }
  }
  return count;
};

/**
 * Install the project's runtime over its asset source: the asset + scene + bundle
 * plugins and the project file loaders (`.rmesh`, `.hdr`, kind-routed `.remat`,
 * and glTF). Idempotent — guarded on the {@link AssetServer}, so it runs once per
 * App regardless of how many entry points call it.
 *
 * Called on project open (independent of whether a startup scene exists) so a
 * project without a startup scene still has scene loading, bundles, and glTF
 * support — assigning a model in the editor works before any scene is saved.
 */
export const installProjectRuntime = (
  app: App,
  source: AssetSource,
  material?: MaterialPlugin<StandardMaterial>,
): void => {
  if (app.getResource(AssetServer) !== undefined) return;

  app.addPlugin(new AssetPlugin({ source }));
  app.addPlugin(new ScenePlugin());
  app.addPlugin(new BundlePlugin());

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

  // glTF loading + instantiation + attachment round-trip: registers `.glb`/
  // `.gltf` loaders, the `Gltf` handle store, the `GltfSceneRoot` component +
  // reactor, and the composition provider that round-trips entities attached
  // into instantiated subtrees. Needs a `StandardMaterial` plugin to map glTF
  // materials into; skipped without one.
  if (material !== undefined && app.getResource(Gltfs) === undefined) {
    app.addPlugin(new GltfPlugin({ material }));
  }
};

/**
 * Load the project's startup scene from disk and spawn it into the world — the
 * host-backed `SceneSource` the studio uses instead of the in-memory showcase
 * when a project is open. Ensures the project runtime is installed (idempotent),
 * adopts the scanned manifest, loads the scene by GUID, settles, and spawns — the
 * scene's referenced assets then stream in on demand (ADR-0100), not as a bulk
 * preload. Returns false (so the caller can fall back) if the scene isn't found.
 */
export const loadProjectScene = async (
  app: App,
  source: AssetSource,
  manifest: AssetManifest,
  startupSceneGuid: string,
  material?: MaterialPlugin<StandardMaterial>,
): Promise<boolean> => {
  installProjectRuntime(app, source, material);

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
