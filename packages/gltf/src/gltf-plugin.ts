import type { App, MaterialPlugin, PluginObject, StandardMaterial } from '@retro-engine/engine';
import { AssetServer, Images, Meshes, registerAssetKind } from '@retro-engine/engine';

import { gltfAssetKindDescriptor } from './gltf-asset-kind';
import { addGltfInstantiation } from './gltf-instantiate';
import { createGltfImporter } from './gltf-importer';
import { Gltfs } from './gltf-root';
import { createImageBitmapDecoder } from './image-decoder';
import type { ImageDecoder } from './image-decoder';

/** Configuration for {@link GltfPlugin}. */
export interface GltfPluginOptions {
  /**
   * The `StandardMaterial` material plugin glTF maps materials into. The plugin
   * needs both its `Materials` store (where imported materials are registered)
   * and its `MeshMaterial3d` subclass (the component the renderer queries), so
   * the plugin instance is passed rather than the bare store. Add it to the
   * `App` before {@link GltfPlugin}.
   */
  readonly material: MaterialPlugin<StandardMaterial>;
  /**
   * Decodes glTF image bytes into pixels. Defaults to the `createImageBitmap`
   * decoder, which runs in the browser and the Tauri webview; supply your own
   * in a headless environment (it has no DOM image API).
   */
  readonly decoder?: ImageDecoder;
}

/**
 * Adds `.gltf` / `.glb` loading and node-graph instantiation to an `App`.
 *
 * On build it registers the glTF {@link AssetServer} importer for both
 * extensions — decoding a document into engine meshes, materials, and images
 * and assembling a `Gltf` root asset — and installs the reactor that turns a
 * `GltfSceneRoot` entity into a navigable, named entity tree mirroring the glTF
 * scene graph. Opt-in: an `App` that never loads glTF pays nothing.
 *
 * Requires an `AssetPlugin` (the `AssetServer`), the engine's `Meshes` /
 * `Images` stores, and the `StandardMaterial` material plugin to be added first.
 */
export class GltfPlugin implements PluginObject {
  private readonly material: MaterialPlugin<StandardMaterial>;
  private readonly decoder: ImageDecoder;

  constructor(options: GltfPluginOptions) {
    this.material = options.material;
    this.decoder = options.decoder ?? createImageBitmapDecoder;
  }

  name(): string {
    return 'GltfPlugin';
  }

  category(): 'engine' {
    return 'engine';
  }

  build(app: App): void {
    const server = app.getResource(AssetServer);
    if (server === undefined) {
      throw new Error('GltfPlugin: no AssetServer — add AssetPlugin before GltfPlugin.');
    }
    const meshes = app.getResource(Meshes);
    const images = app.getResource(Images);
    const materials = app.getResource(this.material.Materials);
    if (meshes === undefined || images === undefined || materials === undefined) {
      throw new Error(
        'GltfPlugin: missing Meshes/Images/Materials store — add CorePlugin and the StandardMaterial MaterialPlugin before GltfPlugin.',
      );
    }

    let gltfs = app.getResource(Gltfs);
    if (gltfs === undefined) {
      gltfs = new Gltfs();
      app.insertResource(gltfs);
    }

    const importer = createGltfImporter({ meshes, materials, images }, this.decoder);
    server.registerLoader('gltf', gltfs, importer);
    server.registerLoader('glb', gltfs, importer);
    registerAssetKind(app, gltfAssetKindDescriptor);

    addGltfInstantiation(app, this.material.MeshMaterial3d);
  }
}
