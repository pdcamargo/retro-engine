import { AssetServer } from '../asset/asset-server';
import type { App } from '../index';
import type { PluginObject } from '../plugin';

import { Scenes } from './scene-asset';
import { createSceneImporter } from './scene-importer';
import { addSceneInstantiation } from './scene-reactor';

/**
 * Adds `.scene` loading and instantiation to an `App`.
 *
 * On build it registers the {@link Scene} importer on the {@link AssetServer}
 * (so `assetServer.load<Scene>('x.scene')` yields a `Handle<Scene>`), inserts the
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

    server.registerLoader('scene', scenes, createSceneImporter());
    addSceneInstantiation(app);
  }
}
