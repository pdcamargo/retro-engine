import type { AssetImporter, Assets, AssetSerializer } from '@retro-engine/assets';
import type { RegisteredType } from '@retro-engine/reflect';

import { AssetServer } from '../asset/asset-server';
import type { App } from '../index';

import type { Material } from './material';

/** File extension for a material asset (`<name>.remat`). */
export const MATERIAL_ASSET_EXTENSION = 'remat';

/**
 * Everything needed to treat one material type as an asset: its `kind` (the
 * material class name, used as the `.meta` kind + the kind-keyed loader tag),
 * its per-type `Materials<M>` store, its registered reflection type, its
 * importer / serializer, and a factory for a default instance ("create material").
 */
export interface MaterialTypeDescriptor {
  readonly kind: string;
  readonly store: Assets<Material>;
  readonly reflect: RegisteredType;
  readonly importer: AssetImporter<Material>;
  readonly serializer: AssetSerializer<Material>;
  makeDefault(): Material;
}

/**
 * Render/main-world resource listing every registered material type as an asset.
 * Each {@link import('./material-plugin').MaterialPlugin} registers its
 * descriptor on `build`; the studio reads it to enumerate types (create-material,
 * inspector, preview) and `registerMaterialLoaders` reads it to wire kind-keyed
 * loaders once an `AssetServer` exists. Derived registry — not serialized.
 *
 * @internal
 */
export class MaterialTypes {
  private readonly byKind = new Map<string, MaterialTypeDescriptor>();

  register(descriptor: MaterialTypeDescriptor): void {
    this.byKind.set(descriptor.kind, descriptor);
  }

  get(kind: string): MaterialTypeDescriptor | undefined {
    return this.byKind.get(kind);
  }

  all(): IterableIterator<MaterialTypeDescriptor> {
    return this.byKind.values();
  }
}

/**
 * Wire a kind-keyed `.remat` loader for every registered material type, so a
 * scene's material reference (or a direct `loadByGuid`) resolves into the right
 * per-type store. Idempotent and safe to call repeatedly — after the
 * `AssetServer` is inserted, and again after a project registers its own
 * material plugins. No-op until both an `AssetServer` and `MaterialTypes` exist.
 */
export const registerMaterialLoaders = (app: App): void => {
  const server = app.getResource(AssetServer);
  const types = app.getResource(MaterialTypes);
  if (server === undefined || types === undefined) return;
  for (const descriptor of types.all()) {
    server.registerLoaderByKind(descriptor.kind, descriptor.store, descriptor.importer);
  }
};
