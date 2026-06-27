import { t } from '@retro-engine/reflect';

import { registerAssetKind } from '../asset/asset-kinds';
import { registerAssetStore } from '../asset/asset-stores';
import { AssetServer } from '../asset/asset-server';
import type { App } from '../index';
import type { PluginObject } from '../plugin';
import { MorphGpu } from './morph-gpu';
import { MorphWeights } from './morph-weights';
import {
  SPARSE_MORPH_TARGET_ASSET_KIND,
  SparseMorphTargets,
  createSparseMorphTargetImporter,
} from './sparse-morph-target-asset';

/**
 * Engine plugin for runtime morph targets (blend shapes). Registers the
 * {@link MorphWeights} component so morphing meshes round-trip through scenes and
 * code reloads, and so animation channels and the inspector can address weights
 * by target name.
 *
 * Also registers the sparse morph-target asset kind (`.target` files — MakeHuman's
 * topology-locked per-vertex deltas), so a project's target files are discovered,
 * GUID-identified, and loadable into {@link SparseMorphTargets} for the character
 * creator to compose onto a base mesh.
 *
 * The GPU render path — the morphed pipeline variant, the per-mesh delta buffer,
 * and the per-frame weights upload — is added by this plugin only when a renderer
 * is present and reports `RendererCapabilities.storageBuffers`. On a backend
 * without it (WebGL2) morphing awaits the data-texture delivery path and a
 * morphing mesh draws from its base geometry.
 */
export class MorphPlugin implements PluginObject {
  name(): string {
    return 'MorphPlugin';
  }

  build(app: App): void {
    if (app.getResource(MorphGpu) === undefined) app.insertResource(new MorphGpu());

    app.registerComponent(
      MorphWeights,
      { names: t.array(t.string), weights: t.array(t.number) },
      { name: 'MorphWeights', make: () => new MorphWeights() },
    );

    if (app.getResource(SparseMorphTargets) === undefined) {
      app.insertResource(new SparseMorphTargets());
    }
    const targets = app.getResource(SparseMorphTargets)!;
    registerAssetStore(app, SPARSE_MORPH_TARGET_ASSET_KIND, targets);
    // `.target` files are source assets a user drops into the project (the raw
    // MakeHuman data), so they are discoverable: a loose one gets a sidecar minted.
    registerAssetKind(app, {
      kind: SPARSE_MORPH_TARGET_ASSET_KIND,
      extensions: ['target'],
      discoverable: true,
      category: 'morph',
    });
    // Read-side importer once an AssetServer exists; deferred via whenResource so
    // plugin-add order does not matter.
    app.whenResource(AssetServer, (server) => {
      server.registerLoader('target', targets, createSparseMorphTargetImporter());
    });
  }
}
