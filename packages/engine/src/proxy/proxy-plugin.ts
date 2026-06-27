import { registerAssetKind } from '../asset/asset-kinds';
import { registerAssetStore } from '../asset/asset-stores';
import { AssetServer } from '../asset/asset-server';
import type { App } from '../index';
import type { PluginObject } from '../plugin';
import {
  PROXY_FITTING_ASSET_KIND,
  ProxyFittings,
  createProxyFittingImporter,
} from './proxy-fitting-asset';

/**
 * Engine plugin for garment proxy fitting. Registers the `.mhclo` asset kind so a
 * project's garment fittings are discovered, GUID-identified, and loadable into
 * {@link ProxyFittings}; the character creator fits these onto a body via
 * `fitProxy` so clothes follow body shape. The garment's geometry loads as an
 * ordinary `ObjMesh`.
 */
export class ProxyPlugin implements PluginObject {
  name(): string {
    return 'ProxyPlugin';
  }

  build(app: App): void {
    if (app.getResource(ProxyFittings) === undefined) app.insertResource(new ProxyFittings());
    const fittings = app.getResource(ProxyFittings)!;
    registerAssetStore(app, PROXY_FITTING_ASSET_KIND, fittings);
    // `.mhclo` files are source assets a user drops into a project, so discoverable.
    registerAssetKind(app, {
      kind: PROXY_FITTING_ASSET_KIND,
      extensions: ['mhclo'],
      discoverable: true,
      category: 'garment',
    });
    app.whenResource(AssetServer, (server) => {
      server.registerLoader('mhclo', fittings, createProxyFittingImporter());
    });
  }
}
