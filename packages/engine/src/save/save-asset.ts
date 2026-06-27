import type { AssetGuid, AssetSink, Assets, Handle } from '@retro-engine/assets';

import type { App } from '../index';
import { AssetServer } from '../asset/asset-server';
import { AssetSerializers } from '../asset/asset-serializers';
import { AssetStores } from '../asset/asset-stores';

/**
 * Serialize a single loaded asset to its project file.
 *
 * Resolves the asset's per-kind store + registered serializer, encodes the live
 * value, and writes it through `sink` at `location` (the asset's manifest path).
 * The complement of the full {@link serializeProject} pipeline, for persisting one
 * edited asset (e.g. a material changed in the inspector) without rewriting the
 * whole project.
 *
 * Returns `false` (a no-op) when the asset system is not installed, the kind has
 * no serializer or store, or the asset is not loaded — saving an asset that moved
 * on should not throw. A derived/sub-asset (read-only, no `.remat` of its own) has
 * no `location` to pass here; promote it to a standalone asset first.
 *
 * @param guid the asset's GUID (must be loaded in its store)
 * @param kind the asset kind tag the serializer + store are registered under
 * @param location the project-relative file path to write (from the manifest)
 */
export const saveAsset = async (
  app: App,
  guid: AssetGuid,
  kind: string,
  location: string,
  sink: AssetSink,
): Promise<boolean> => {
  const serializers = app.getResource(AssetSerializers);
  if (serializers === undefined) return false;
  const serializer = serializers.get(kind);
  if (serializer === undefined) return false;

  // The store backing a kind is keyed differently from the manifest kind for
  // some types (materials register their store under `Materials<Name>` but their
  // serializer + `.meta` under `Name`), so prefer the server's per-load guid→store
  // mapping and fall back to the kind-keyed AssetStores registry.
  const server = app.getResource(AssetServer);
  const resolved = server?.storeForGuid(guid);
  let store: Assets<unknown> | undefined = resolved?.store;
  let handle: Handle<unknown> | undefined = resolved?.handle;
  if (store === undefined) {
    store = app.getResource(AssetStores)?.storeFor(kind);
    handle = store?.handleByGuid(guid);
  }
  if (store === undefined || handle === undefined) return false;

  const value = store.get(handle);
  if (value === undefined) return false;
  await sink.write(location, serializer.serialize(value as object));
  return true;
};
