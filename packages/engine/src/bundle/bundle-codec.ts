import type { AssetGuid } from '@retro-engine/assets';
import type { ComponentType } from '@retro-engine/ecs';
import {
  type DecodeEnv,
  encodeComponent,
  type EncodeEnv,
  type SerializedValue,
  type TypeRegistry,
} from '@retro-engine/reflect';

import { AssetServer } from '../asset/asset-server';
import type { App } from '../index';

/**
 * Encode env for a bundle's components. Bundles never reference entities;
 * asset-handle fields round-trip by GUID (resolved on instantiate through the
 * {@link AssetServer}), mirroring how a material asset persists its textures.
 */
export const bundleEncodeEnv = (registry: TypeRegistry): EncodeEnv => ({
  registry,
  entityId: () => {
    throw new Error('bundle: a bundle component cannot reference an entity');
  },
  handleRef: (_assetType, handle) => handle.guid,
});

/** Decode env mirroring {@link bundleEncodeEnv}: handles resolve by GUID, entity refs are rejected. */
export const bundleDecodeEnv = (app: App, registry: TypeRegistry): DecodeEnv => ({
  registry,
  entity: () => {
    throw new Error('bundle: a bundle component cannot reference an entity');
  },
  resolveHandle: (_assetType, guid) => {
    const server = app.getResource(AssetServer);
    if (server === undefined) {
      throw new Error("bundle: an AssetServer is required to resolve a bundle component's asset handles");
    }
    return server.loadByGuid(guid as AssetGuid);
  },
});

/**
 * Encode component instances into the {@link SerializedValue}s a
 * {@link import('./bundle-definition').BundleDefinition} stores. Each instance's
 * type must already be registered in `registry` (its owning plugin's
 * `registerComponent` must run before the bundle is registered); an unregistered
 * component throws with a message naming it.
 */
export const encodeBundleComponents = (
  registry: TypeRegistry,
  components: readonly object[],
): SerializedValue[] => {
  const env = bundleEncodeEnv(registry);
  return components.map((component) => {
    const ctor = (component as { constructor: ComponentType<object> }).constructor;
    const reg = registry.getByCtor(ctor);
    if (reg === undefined) {
      throw new Error(
        `bundle: component '${ctor.name}' is not registered — register its component schema (app.registerComponent) before the bundle that includes it.`,
      );
    }
    return encodeComponent(reg, component, env);
  });
};
