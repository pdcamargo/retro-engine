import { registerAssetKind } from '../asset/asset-kinds';
import { AssetServer } from '../asset/asset-server';
import type { App } from '../index';
import type { PluginObject } from '../plugin';
import { SCENE_ASSET_KIND } from '../save/serialize-project';

import { Scenes } from './scene-asset';
import { createSceneImporter } from './scene-importer';
import { addSceneInstantiation } from './scene-reactor';

/** The manifest `kind` tag used for prefab documents. */
export const PREFAB_ASSET_KIND = 'Prefab';

/** The file extension prefab documents are written with. */
export const PREFAB_ASSET_EXTENSION = 'prefab';

/**
 * Adds `.rescene` loading and instantiation to an `App`.
 *
 * On build it registers the {@link Scene} importer on the {@link AssetServer}
 * (so `assetServer.load<Scene>('x.rescene')` yields a `Handle<Scene>`), inserts the
 * {@link Scenes} store, and installs the reactor that turns a `SceneRoot` entity
 * into a live entity graph once its scene is ready. Opt-in: an `App` that never
 * loads scenes pays nothing.
 *
 * Requires an `AssetPlugin` (for the `AssetServer`) to be added first. Pair with
 * `App.initState` + `App.addScene` to gate a scene behind a state.
 */
export class ScenePlugin implements PluginObject {
  name(): string {
    return 'ScenePlugin';
  }

  category(): 'engine' {
    return 'engine';
  }

  build(app: App): void {
    const server = app.getResource(AssetServer);
    if (server === undefined) {
      throw new Error('ScenePlugin: no AssetServer — add AssetPlugin before ScenePlugin.');
    }

    let scenes = app.getResource(Scenes);
    if (scenes === undefined) {
      scenes = new Scenes();
      app.insertResource(scenes);
    }

    server.registerLoader('rescene', scenes, createSceneImporter());
    // `.rescene` files are authored through save (always with a sidecar), so they
    // are catalogued but not discovered as loose assets.
    registerAssetKind(app, {
      kind: SCENE_ASSET_KIND,
      extensions: ['rescene'],
      discoverable: false,
      category: 'scene',
    });

    // A prefab is a Scene-shaped asset: same wire format, same `Scenes` store,
    // same `SceneRoot` mount path — distinguished only by its kind tag (so the
    // editor and asset catalogue treat it as a reusable object, and the two can
    // diverge later without reclassifying existing files). The kind loader routes
    // a `Prefab`-tagged manifest entry into the shared store; the mount path
    // resolves it by GUID and never inspects the kind.
    server.registerLoaderByKind(PREFAB_ASSET_KIND, scenes, createSceneImporter());
    registerAssetKind(app, {
      kind: PREFAB_ASSET_KIND,
      extensions: [PREFAB_ASSET_EXTENSION],
      discoverable: false,
      category: 'prefab',
    });

    addSceneInstantiation(app);
  }
}
