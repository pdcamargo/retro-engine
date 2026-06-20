import type { AssetGuid, AssetImporter, AssetSerializer } from '@retro-engine/assets';
import type { ComponentType } from '@retro-engine/ecs';
import {
  decodeComponent,
  type DecodeEnv,
  encodeComponent,
  type EncodeEnv,
  type RegisteredType,
  type SerializedValue,
} from '@retro-engine/reflect';

import { AssetServer } from '../asset/asset-server';
import type { App } from '../index';
import { AppTypeRegistry } from '../scene/app-type-registry';

import type { Material } from './material';

/** On-disk format version for a `.remat` material asset. */
export const MATERIAL_FORMAT_VERSION = 1;

/** A `.remat` file: a format version wrapping the codec's serialized material value. */
interface MaterialFile {
  readonly formatVersion: number;
  /** The material value as `{ type, version, data }`; `type` is the material kind. */
  readonly material: SerializedValue;
}

const registryEntry = (app: App, ctor: ComponentType<object>): RegisteredType => {
  const reg = app.getResource(AppTypeRegistry)?.registry.getByCtor(ctor);
  if (reg === undefined) {
    throw new Error(
      `material asset: '${ctor.name}' is not registered — its MaterialPlugin must register the material type before it can be (de)serialized.`,
    );
  }
  return reg;
};

// Materials never reference entities; textures (and other handle fields) round-
// trip by GUID, resolved on load through the AssetServer so they stream in.
const encodeEnv = (app: App): EncodeEnv => ({
  registry: app.getResource(AppTypeRegistry)!.registry,
  entityId: () => {
    throw new Error('material asset: a material cannot reference an entity');
  },
  handleRef: (_assetType, handle) => handle.guid,
});

const decodeEnv = (app: App): DecodeEnv => ({
  registry: app.getResource(AppTypeRegistry)!.registry,
  entity: () => {
    throw new Error('material asset: a material cannot reference an entity');
  },
  resolveHandle: (_assetType, guid) => {
    const server = app.getResource(AssetServer);
    if (server === undefined) {
      throw new Error('material asset: an AssetServer is required to resolve a material\'s referenced textures');
    }
    return server.loadByGuid(guid as AssetGuid);
  },
});

const decodeMaterial = <M extends Material>(app: App, ctor: ComponentType<object>, bytes: Uint8Array): M => {
  const file = JSON.parse(new TextDecoder().decode(bytes)) as MaterialFile;
  return decodeComponent(registryEntry(app, ctor), file.material, decodeEnv(app)) as unknown as M;
};

/**
 * Round-trip serializer for a material type's `.remat` asset, wrapping the
 * reflection codec against the material's registered (bind-group-derived)
 * schema. Texture handles serialize by GUID. Registered per material type via
 * its {@link import('./material-plugin').MaterialPlugin}; used by the
 * project-save layer to write a material back after an inspector edit.
 */
export const createMaterialSerializer = <M extends Material>(
  app: App,
  ctor: ComponentType<object>,
): AssetSerializer<M> => ({
  serialize(material) {
    const file: MaterialFile = {
      formatVersion: MATERIAL_FORMAT_VERSION,
      material: encodeComponent(registryEntry(app, ctor), material as object, encodeEnv(app)),
    };
    return new TextEncoder().encode(`${JSON.stringify(file, null, 2)}\n`);
  },
  deserialize(bytes) {
    return decodeMaterial(app, ctor, bytes);
  },
});

/**
 * Asset importer for a material type's `.remat` files — decodes bytes into a
 * material instance, streaming referenced textures by GUID. Registered as a
 * kind-keyed loader (the material type name) so `loadByGuid` resolves a scene's
 * material reference into the correct per-type store.
 */
export const createMaterialImporter = <M extends Material>(
  app: App,
  ctor: ComponentType<object>,
): AssetImporter<M> => (bytes) => decodeMaterial<M>(app, ctor, bytes);
