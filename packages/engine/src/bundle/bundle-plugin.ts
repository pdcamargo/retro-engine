import { registerAssetSerializer } from '../asset/asset-serializers';
import type { App } from '../index';
import type { PluginObject } from '../plugin';

import { AppBundleRegistry } from './bundle-registry';
import { BUNDLE_ASSET_KIND, createBundleSerializer } from './bundle-asset';

/**
 * Wires bundle assets into an App: ensures the {@link AppBundleRegistry} exists
 * and registers the `.rebundle` serializer under {@link BUNDLE_ASSET_KIND} so the
 * project-save layer can write authored bundles back to disk.
 *
 * Code-defined bundles (via `App.registerBundle`) need no plugin — the registry
 * is created with the App. This plugin adds the *asset* side: persistence of
 * user-authored `.rebundle` bundles. Add it alongside the `AssetPlugin`.
 */
export class BundlePlugin implements PluginObject {
  name(): string {
    return 'BundlePlugin';
  }

  category(): 'engine' {
    return 'engine';
  }

  build(app: App): void {
    if (app.getResource(AppBundleRegistry) === undefined) {
      app.insertResource(new AppBundleRegistry());
    }
    registerAssetSerializer(app, BUNDLE_ASSET_KIND, createBundleSerializer());
  }
}
