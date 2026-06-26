import { asAssetIndex, makeHandle } from '@retro-engine/assets';
import type { Entity } from '@retro-engine/ecs';
import { t } from '@retro-engine/reflect';

import { registerAssetKind } from '../asset/asset-kinds';
import { registerAssetSerializer } from '../asset/asset-serializers';
import { registerAssetStore } from '../asset/asset-stores';
import { AssetServer } from '../asset/asset-server';
import type { App } from '../index';
import type { PluginObject } from '../plugin';
import type { AnimationClip } from './animation-clip';
import {
  ANIMATION_CLIP_ASSET_KIND,
  AnimationClips,
  createAnimationClipImporter,
  createAnimationClipSerializer,
} from './animation-clip-asset';
import type { AnimationController } from './animation-controller';
import {
  ANIMATION_CONTROLLER_ASSET_KIND,
  AnimationControllers,
  createAnimationControllerImporter,
  createAnimationControllerSerializer,
} from './animation-controller-asset';
import { AnimationControllerPlayer } from './animation-controller-player';
import {
  AnimationLayerRuntimes,
  AnimationLayers,
  ReferencePoses,
} from './animation-layers';
import { AnimationPlayer, AnimationTarget } from './animation-player';
import { addAnimationSampling } from './animation-system';
import type { AvatarMask } from './avatar-mask';
import {
  AVATAR_MASK_ASSET_KIND,
  AvatarMasks,
  createAvatarMaskImporter,
  createAvatarMaskSerializer,
} from './avatar-mask-asset';
import { AnimationPoses } from './pose';
import { AnimationControllerRuntimes } from './state-machine';

/**
 * Engine plugin for keyframe animation playback. Registers the
 * {@link AnimationClip} asset kind (`.ranim`), its store/serializer/loader, the
 * authored {@link AnimationPlayer} / {@link AnimationTarget} components, and the
 * sampling system that drives clip tracks into their targeted reflected
 * properties each frame.
 *
 * Added by the engine's core plugin, so an `App` always has the
 * {@link AnimationClips} store available (the glTF loader registers parsed clips
 * into it). Sampling runs before transform propagation, so a clip that drives
 * bone `Transform`s deforms a skinned mesh the same frame via the skinning path.
 */
export class AnimationPlugin implements PluginObject {
  name(): string {
    return 'AnimationPlugin';
  }

  category(): 'engine' {
    return 'engine';
  }

  build(app: App): void {
    if (app.getResource(AnimationClips) === undefined) {
      app.insertResource(new AnimationClips());
    }
    const clips = app.getResource(AnimationClips)!;
    if (app.getResource(AnimationControllers) === undefined) {
      app.insertResource(new AnimationControllers());
    }
    const controllers = app.getResource(AnimationControllers)!;
    if (app.getResource(AvatarMasks) === undefined) {
      app.insertResource(new AvatarMasks());
    }
    const masks = app.getResource(AvatarMasks)!;
    // Per-frame transient pose / state-machine buffers consumed by the sampling
    // system; never serialized.
    if (app.getResource(AnimationPoses) === undefined) {
      app.insertResource(new AnimationPoses());
    }
    if (app.getResource(AnimationControllerRuntimes) === undefined) {
      app.insertResource(new AnimationControllerRuntimes());
    }
    if (app.getResource(AnimationLayerRuntimes) === undefined) {
      app.insertResource(new AnimationLayerRuntimes());
    }
    if (app.getResource(ReferencePoses) === undefined) {
      app.insertResource(new ReferencePoses());
    }

    registerAssetStore(app, ANIMATION_CLIP_ASSET_KIND, clips);
    registerAssetSerializer(app, ANIMATION_CLIP_ASSET_KIND, createAnimationClipSerializer());
    // `.ranim` files are produced by a save or a glTF import (with a sidecar),
    // not dropped in loose, so they are catalogued but not discovered.
    registerAssetKind(app, {
      kind: ANIMATION_CLIP_ASSET_KIND,
      extensions: ['ranim'],
      discoverable: false,
      category: 'animation',
    });

    registerAssetStore(app, ANIMATION_CONTROLLER_ASSET_KIND, controllers);
    registerAssetSerializer(
      app,
      ANIMATION_CONTROLLER_ASSET_KIND,
      createAnimationControllerSerializer(clips),
    );
    // `.ranimctrl` files reference clips by GUID and, like `.ranim`, are authored/
    // saved with a sidecar rather than dropped in loose.
    registerAssetKind(app, {
      kind: ANIMATION_CONTROLLER_ASSET_KIND,
      extensions: ['ranimctrl'],
      discoverable: false,
      category: 'animation',
    });

    registerAssetStore(app, AVATAR_MASK_ASSET_KIND, masks);
    registerAssetSerializer(app, AVATAR_MASK_ASSET_KIND, createAvatarMaskSerializer());
    // `.ramask` files are authored/saved with a sidecar rather than dropped in loose.
    registerAssetKind(app, {
      kind: AVATAR_MASK_ASSET_KIND,
      extensions: ['ramask'],
      discoverable: false,
      category: 'animation',
    });

    // Register the read-side importers when an AssetServer is present so a
    // standalone `.ranim` / `.ranimctrl` / `.ramask` loads; glTF-produced clips
    // arrive as sub-assets and need no loader.
    const server = app.getResource(AssetServer);
    if (server !== undefined) {
      server.registerLoader('ranim', clips, createAnimationClipImporter());
      server.registerLoader('ranimctrl', controllers, createAnimationControllerImporter(clips));
      server.registerLoader('ramask', masks, createAvatarMaskImporter());
      // glTF labels its extracted clips `Animation0`, `Animation1`, … so a
      // sub-asset reference `"<modelGuid>#Animation0"` resolves into this store.
      server.registerSubAssetStore('Animation', clips);
    }

    app.registerComponent(
      AnimationPlayer,
      {
        clip: t.handle<AnimationClip>(ANIMATION_CLIP_ASSET_KIND),
        speed: t.number,
        playing: t.boolean,
        repeat: t.enum('loop', 'once'),
        time: t.number.skip(),
      },
      { name: 'AnimationPlayer', make: () => new AnimationPlayer(makeHandle(asAssetIndex(0))) },
    );
    app.registerComponent(
      AnimationTarget,
      { id: t.string, player: t.entity() },
      { name: 'AnimationTarget', make: () => new AnimationTarget('', 0 as Entity) },
    );
    app.registerComponent(
      AnimationControllerPlayer,
      {
        controller: t.handle<AnimationController>(ANIMATION_CONTROLLER_ASSET_KIND),
        speed: t.number,
        playing: t.boolean,
        parameters: t.array(t.struct({ name: t.string, value: t.number })),
      },
      {
        name: 'AnimationControllerPlayer',
        make: () => new AnimationControllerPlayer(makeHandle(asAssetIndex(0))),
      },
    );
    app.registerComponent(
      AnimationLayers,
      {
        layers: t.array(
          t.struct({
            weight: t.number,
            blend: t.enum('override', 'additive'),
            mask: t.handle<AvatarMask>(AVATAR_MASK_ASSET_KIND).optional(),
            source: t.variant('kind', {
              clip: {
                clip: t.handle<AnimationClip>(ANIMATION_CLIP_ASSET_KIND),
                speed: t.number,
                playing: t.boolean,
                repeat: t.enum('loop', 'once'),
              },
              controller: {
                controller: t.handle<AnimationController>(ANIMATION_CONTROLLER_ASSET_KIND),
                speed: t.number,
                playing: t.boolean,
                parameters: t.array(t.struct({ name: t.string, value: t.number })),
              },
            }),
          }),
        ),
      },
      { name: 'AnimationLayers', make: () => new AnimationLayers() },
    );

    addAnimationSampling(app);
  }
}
