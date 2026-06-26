import { registerAssetKind } from '../../asset/asset-kinds';
import { registerAssetSerializer } from '../../asset/asset-serializers';
import { AssetServer } from '../../asset/asset-server';
import { registerAssetStore } from '../../asset/asset-stores';
import type { App } from '../../index';
import type { PluginObject } from '../../plugin';
import {
  createRetargetRigImporter,
  createRetargetRigSerializer,
  RETARGET_RIG_ASSET_KIND,
  RetargetRigs,
} from './retarget-rig-asset';

/**
 * Engine plugin for animation retargeting. Registers the {@link RetargetRig}
 * asset kind (`.rerig`) — a skeleton's humanoid rig description — with its
 * store, serializer, and loader.
 *
 * Retargeting itself is a clip-production step (`retargetClip`), not a per-frame
 * system: the clips it produces are ordinary {@link AnimationClip}s that the
 * existing animation and IK systems already drive. So this plugin adds no
 * component schema and no system — only the rig-description asset that the
 * transform consumes. Added by the engine's core plugin after the IK plugin.
 */
export class RetargetPlugin implements PluginObject {
  name(): string {
    return 'RetargetPlugin';
  }

  category(): 'engine' {
    return 'engine';
  }

  build(app: App): void {
    if (app.getResource(RetargetRigs) === undefined) {
      app.insertResource(new RetargetRigs());
    }
    const rigs = app.getResource(RetargetRigs)!;

    registerAssetStore(app, RETARGET_RIG_ASSET_KIND, rigs);
    registerAssetSerializer(app, RETARGET_RIG_ASSET_KIND, createRetargetRigSerializer());
    // `.rerig` files are built from a skeleton or saved with a sidecar rather
    // than dropped in loose, so they are catalogued but not discovered.
    registerAssetKind(app, {
      kind: RETARGET_RIG_ASSET_KIND,
      extensions: ['rerig'],
      discoverable: false,
      category: 'animation',
    });

    const server = app.getResource(AssetServer);
    if (server !== undefined) {
      server.registerLoader('rerig', rigs, createRetargetRigImporter());
    }
  }
}
