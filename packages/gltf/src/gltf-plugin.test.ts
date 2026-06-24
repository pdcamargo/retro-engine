import { describe, expect, it } from 'bun:test';

import type { AssetSource } from '@retro-engine/assets';
import {
  App,
  AppTypeRegistry,
  AssetPlugin,
  AssetServer,
  AssetStores,
  MaterialPlugin,
  StandardMaterial,
  StandardMaterialPlugin,
} from '@retro-engine/engine';

import { makeStubRenderer } from './app-test-support';
import { GLTF_ASSET_KIND } from './gltf-asset-kind';
import { GltfSceneRoot } from './gltf-components';
import { GltfPlugin } from './gltf-plugin';
import { Gltfs } from './gltf-root';

const nullSource: AssetSource = { read: () => Promise.reject(new Error('unused')) };

const withMaterial = (app: App): MaterialPlugin<StandardMaterial> => {
  app.addPlugin(new StandardMaterialPlugin());
  const pbr = new MaterialPlugin(StandardMaterial);
  app.addPlugin(pbr);
  return pbr;
};

describe('GltfPlugin', () => {
  it('inserts a Gltfs store and registers the gltf/glb loaders', () => {
    const app = new App({ renderer: makeStubRenderer() });
    app.addPlugin(new AssetPlugin({ source: nullSource }));
    const pbr = withMaterial(app);
    app.addPlugin(new GltfPlugin({ material: pbr }));

    expect(app.getResource(Gltfs)).toBeInstanceOf(Gltfs);
    const server = app.getResource(AssetServer)!;
    // A registered loader means `load` returns a handle instead of throwing.
    expect(() => server.load('model.gltf')).not.toThrow();
    expect(() => server.load('model.glb')).not.toThrow();
  });

  it('registers GltfSceneRoot as a serializable component bound to the Gltf store', () => {
    const app = new App({ renderer: makeStubRenderer() });
    app.addPlugin(new AssetPlugin({ source: nullSource }));
    const pbr = withMaterial(app);
    app.addPlugin(new GltfPlugin({ material: pbr }));

    // The component has a reflection schema (so it serializes + appears in the
    // editor's Add-Component palette).
    const registry = app.getResource(AppTypeRegistry)!.registry;
    expect(registry.getByCtor(GltfSceneRoot)).toBeDefined();

    // Its handle store is bound, so a scene's GltfSceneRoot reference resolves.
    expect(app.getResource(AssetStores)!.storeFor(GLTF_ASSET_KIND)).toBeInstanceOf(Gltfs);
  });

  it('throws a clear error when no AssetServer is present', () => {
    const app = new App({ renderer: makeStubRenderer() });
    const pbr = withMaterial(app);
    expect(() => app.addPlugin(new GltfPlugin({ material: pbr }))).toThrow(/AssetServer/);
  });

  it('throws when the StandardMaterial store is missing', () => {
    const app = new App({ renderer: makeStubRenderer() });
    app.addPlugin(new AssetPlugin({ source: nullSource }));
    // Construct the material plugin but never add it, so its store is absent.
    const pbr = new MaterialPlugin(StandardMaterial);
    expect(() => app.addPlugin(new GltfPlugin({ material: pbr }))).toThrow(/Materials/);
  });
});
