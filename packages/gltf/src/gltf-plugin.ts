import type { App, MaterialPlugin, PluginObject, StandardMaterial } from '@retro-engine/engine';
import {
  AnimationClips,
  asAssetIndex,
  AssetServer,
  Images,
  makeHandle,
  Meshes,
  registerAssetKind,
  registerAssetStore,
} from '@retro-engine/engine';
import { t } from '@retro-engine/reflect';

import { addGltfAttach } from './gltf-attach';
import { GLTF_ASSET_KIND, gltfAssetKindDescriptor } from './gltf-asset-kind';
import { addGltfAutoRetarget } from './gltf-auto-retarget';
import { GltfSceneRoot } from './gltf-components';
import {
  addGltfBaselineCapture,
  addGltfInstantiation,
  addGltfReinstantiation,
} from './gltf-instantiate';
import { createGltfImporter } from './gltf-importer';
import type { Gltf } from './gltf-root';
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
    const animationClips = app.getResource(AnimationClips);
    if (
      meshes === undefined ||
      images === undefined ||
      materials === undefined ||
      animationClips === undefined
    ) {
      throw new Error(
        'GltfPlugin: missing Meshes/Images/Materials/AnimationClips store — add CorePlugin and the StandardMaterial MaterialPlugin before GltfPlugin.',
      );
    }

    let gltfs = app.getResource(Gltfs);
    if (gltfs === undefined) {
      gltfs = new Gltfs();
      app.insertResource(gltfs);
    }

    const importer = createGltfImporter(
      { meshes, materials, images, animationClips },
      this.decoder,
    );
    server.registerLoader('gltf', gltfs, importer);
    server.registerLoader('glb', gltfs, importer);
    registerAssetKind(app, gltfAssetKindDescriptor);

    // Bind the `Gltf` handle store so a scene that references a glTF by GUID
    // resolves its `GltfSceneRoot.handle` against this store on load.
    registerAssetStore(app, GLTF_ASSET_KIND, gltfs);

    // `GltfSceneRoot` is authored state — the entity says "instantiate this glTF
    // here". It serializes (handle + chosen scene); the instantiated subtree it
    // expands into is derived and rebuilt on load, so consumers exclude those
    // entities from a scene save. The placeholder handle the explicit make
    // supplies is overwritten as soon as a real glTF is assigned or decoded.
    app.registerComponent(
      GltfSceneRoot,
      { handle: t.handle<Gltf>(GLTF_ASSET_KIND), scene: t.number.optional() },
      { name: 'GltfSceneRoot', make: () => new GltfSceneRoot(makeHandle(asAssetIndex(0))) },
    );

    addGltfInstantiation(app, this.material.MeshMaterial3d);
    // Snapshot each instantiated subtree's pristine state so a scene save can
    // persist only the user's edits to derived nodes (and restore them on load).
    addGltfBaselineCapture(app);
    // Re-instantiate the subtree when the model is swapped, preserving authored
    // attachments; round-trip attachments onto nodes (composition provider +
    // load-time rebind).
    addGltfReinstantiation(app);
    addGltfAttach(app);
    // Auto-retarget a foreign clip (authored for a different model) onto this
    // rig at bind time, so it plays without a retarget step. Runs before the
    // animation sampler; no-op for a clip native to the rig's model.
    addGltfAutoRetarget(app);
  }
}
