import type { AssetSerializer, AssetSerializerRegistry } from '@retro-engine/assets';

import type { App } from '../index';

/**
 * Maps an asset-kind tag to the {@link AssetSerializer} that writes that kind to
 * bytes. The write-side mirror of the importer registration the {@link AssetServer}
 * holds for reading: an asset kind becomes persistable by registering a
 * serializer here, never by extending a base serializer.
 *
 * Populated by each kind-owning plugin in `build` via
 * {@link registerAssetSerializer}; read by the project-save layer when it
 * promotes an in-memory asset to a project asset.
 */
export class AssetSerializers implements AssetSerializerRegistry {
  private readonly byKind = new Map<string, AssetSerializer<unknown>>();

  /** Register `serializer` for the asset-kind tag `kind`. A later registration replaces the earlier one. */
  register<T>(kind: string, serializer: AssetSerializer<T>): void {
    this.byKind.set(kind, serializer as AssetSerializer<unknown>);
  }

  /** Look up the serializer registered for `kind`, if any. */
  get<T>(kind: string): AssetSerializer<T> | undefined {
    return this.byKind.get(kind) as AssetSerializer<T> | undefined;
  }
}

/**
 * Register `serializer` under `kind` on the App's {@link AssetSerializers}
 * resource, creating the resource on first use. Call from a kind-owning plugin's
 * `build` (the same place it registers the matching importer for reading), so the
 * project-save layer can write that kind's assets back to bytes.
 */
export const registerAssetSerializer = <T>(
  app: App,
  kind: string,
  serializer: AssetSerializer<T>,
): void => {
  let serializers = app.getResource(AssetSerializers);
  if (serializers === undefined) {
    serializers = new AssetSerializers();
    app.insertResource(serializers);
  }
  serializers.register(kind, serializer);
};
