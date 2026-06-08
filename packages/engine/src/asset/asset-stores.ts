import type { AssetGuid, Assets, Handle } from '@retro-engine/assets';

import type { App } from '../index';

/**
 * The reflection asset-type keys for the engine's fixed-store handle fields —
 * the single source of truth shared between a component's `t.handle(...)` schema
 * and the {@link AssetStores} registration that backs it.
 *
 * Material stores are not here: each material class owns its own store, so its
 * key is computed per class (`Materials<MyMaterial>` / `Materials2d<MyMaterial>`)
 * by the material plugins.
 */
export const ASSET_TYPE = {
  /** `Meshes` store, shared by `Mesh3d` and `Mesh2d`. */
  mesh: 'Mesh',
  /** `Images` store, used by `Sprite.image` / `Sprite.normalMap`. */
  image: 'Image',
  /** `TextureAtlasLayouts` store, used by `TextureAtlas.layout`. */
  textureAtlasLayout: 'TextureAtlasLayout',
} as const;

/**
 * Maps each reflection asset-type key to the {@link Assets} store that owns its
 * values, so a scene's GUID-referenced handles resolve to live assets without a
 * caller-injected resolver. Populated by each store-owning plugin in `build`
 * via {@link registerAssetStore}; read by `spawnScene` when no `resolveHandle`
 * override is passed.
 *
 * This is the in-memory, already-loaded slice of GUID resolution: it resolves a
 * GUID present in a store at spawn time. Loading an absent asset on demand from
 * a manifest or disk is a separate, later concern.
 */
export class AssetStores {
  private readonly stores = new Map<string, Assets<unknown>>();

  /**
   * Bind `assetType` to the store holding that type's assets. The key must match
   * the one the type's `t.handle(assetType)` schema uses. A later registration
   * for the same key replaces the earlier one.
   */
  register(assetType: string, store: Assets<unknown>): void {
    this.stores.set(assetType, store);
  }

  /**
   * The store bound to `assetType`, or `undefined` if none is registered. Used
   * by the project-save layer to read an asset's value out for promotion.
   */
  storeFor(assetType: string): Assets<unknown> | undefined {
    return this.stores.get(assetType);
  }

  /**
   * Resolve the live handle for `guid` in the store bound to `assetType`.
   *
   * Throws if `assetType` has no registered store (a wiring gap — the component
   * was registered but its store was not), and if the GUID is not present in
   * that store (the asset has not been added/loaded; this slice does not fetch
   * it from disk).
   */
  handleFor(assetType: string, guid: string): Handle<unknown> {
    const store = this.stores.get(assetType);
    if (store === undefined) {
      throw new Error(`scene load: no asset store registered for type '${assetType}'`);
    }
    const handle = store.handleByGuid(guid as AssetGuid);
    if (handle === undefined) {
      throw new Error(
        `scene load: asset '${guid}' (type '${assetType}') is not present in its store`,
      );
    }
    return handle;
  }
}

/**
 * Register `store` under `assetType` on the App's {@link AssetStores} resource,
 * creating the resource on first use. Call from a store-owning plugin's `build`
 * right where the store is inserted, so a scene can resolve that type's handles
 * by GUID with no injected resolver.
 */
export const registerAssetStore = <T>(app: App, assetType: string, store: Assets<T>): void => {
  let stores = app.getResource(AssetStores);
  if (stores === undefined) {
    stores = new AssetStores();
    app.insertResource(stores);
  }
  stores.register(assetType, store as Assets<unknown>);
};
