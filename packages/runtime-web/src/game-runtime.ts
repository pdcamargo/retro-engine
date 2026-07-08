import type { AssetGuid } from '@retro-engine/assets';
import {
  type App,
  AmbientLight,
  applyCompletedLoads,
  ASSET_TYPE,
  AssetServer,
  createHdrImporter,
  createImageImporter,
  createMeshImporter,
  EnvironmentMapPlugin,
  Images,
  Light3dPlugin,
  MaterialPlugin,
  Meshes,
  type PluginObject,
  PrepassPlugin,
  registerAssetStore,
  registerMaterialLoaders,
  ScenePlugin,
  Scenes,
  SkyboxPlugin,
  spawnScene,
  StandardMaterial,
  StandardMaterialPlugin,
} from '@retro-engine/engine';
import { GltfPlugin, Gltfs } from '@retro-engine/gltf';
import { vec3 } from '@retro-engine/math';

/**
 * Install the default game-runtime baseline into a running `App` — the render
 * stack and scene/asset runtime a shipped game needs, which the studio host
 * supplies while authoring but a project's `ProjectDefinition` (game logic only)
 * does not. See ADR-0173.
 *
 * Every add is **guarded**: a plugin is added only if a plugin of the same name
 * (or its sentinel resource) is not already present, so a project that composes
 * its own material / light / scene stack stays authoritative and nothing is
 * double-wired. Call after the project's plugins have been added.
 *
 * Returns the `MaterialPlugin<StandardMaterial>` the baseline uses (the one glTF
 * materials are mapped into), so callers can reuse it.
 */
export const installGameRuntime = (app: App): MaterialPlugin<StandardMaterial> => {
  const addUnique = (plugin: PluginObject): void => {
    if (!app.hasPlugin(plugin.name())) app.addPlugin(plugin);
  };

  // Render baseline — the studio host's non-editor render stack (ADR-0173): a
  // depth prepass, the StandardMaterial shading + per-type material plugin, 3D
  // lighting, and skybox / image-based lighting from an environment cubemap.
  addUnique(new PrepassPlugin());
  addUnique(new StandardMaterialPlugin());
  const material = new MaterialPlugin(StandardMaterial);
  addUnique(material);
  addUnique(new Light3dPlugin());
  addUnique(new SkyboxPlugin());
  addUnique(new EnvironmentMapPlugin());
  if (app.getResource(AmbientLight) === undefined) {
    app.insertResource(new AmbientLight({ color: vec3.create(0.6, 0.68, 0.82), brightness: 0.12 }));
  }

  // Scene + asset runtime so a scene's referenced assets stream from the `.rpak`
  // on demand (ADR-0100), not as a bulk preload. Requires an `AssetServer` (wired
  // from the manifest before the project's plugins) — `ScenePlugin` and the loaders
  // register against it. Loader registration is guarded on the `Scenes` store so a
  // repeat call (or a project that already installed scene support) does not
  // re-register loaders (`registerLoader` throws on a duplicate).
  const server = app.getResource(AssetServer);
  if (server !== undefined) {
    const sceneRuntimeNew = app.getResource(Scenes) === undefined;
    addUnique(new ScenePlugin());
    if (sceneRuntimeNew) {
      let meshes = app.getResource(Meshes);
      if (meshes === undefined) {
        meshes = new Meshes();
        app.insertResource(meshes);
        registerAssetStore(app, ASSET_TYPE.mesh, meshes);
      }
      server.registerLoader('rmesh', meshes, createMeshImporter());
      const images = app.getResource(Images);
      if (images !== undefined) {
        server.registerLoader('hdr', images, createHdrImporter());
        const imageImporter = createImageImporter();
        for (const ext of ['png', 'jpg', 'jpeg', 'webp']) {
          server.registerLoader(ext, images, imageImporter);
        }
      }
      // Kind-routed `.remat` loaders for every registered material type, so a scene
      // entity's material reference resolves into the right per-type store on demand.
      registerMaterialLoaders(app);
    }

    // glTF loading + instantiation + attachment round-trip, mapped into the
    // StandardMaterial store. Skipped if the project already wired glTF.
    if (app.getResource(Gltfs) === undefined) app.addPlugin(new GltfPlugin({ material }));
  }

  return material;
};

/**
 * Load a scene asset by GUID from the App's `AssetServer` and spawn it into the
 * world. Loads, settles the async graph, applies completed loads, then resolves
 * the scene handle and spawns it — the scene's referenced assets stream in on
 * demand afterwards. Returns `false` if the scene GUID does not resolve (so the
 * caller can warn and continue). Requires {@link installGameRuntime} (or an
 * equivalent) to have installed the `AssetServer` + `Scenes` store.
 */
export const loadAndSpawnScene = async (app: App, sceneGuid: string): Promise<boolean> => {
  const server = app.getResource(AssetServer);
  if (server === undefined) return false;
  server.loadByGuid(sceneGuid as AssetGuid);
  await server.settle();
  applyCompletedLoads(server);

  const scenes = app.getResource(Scenes);
  if (scenes === undefined) return false;
  const handle = scenes.handleByGuid(sceneGuid as AssetGuid);
  if (handle === undefined) return false;
  const scene = scenes.get(handle);
  if (scene === undefined) return false;

  spawnScene(app, scene.data);
  return true;
};
