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
import { AnimationPlayer, AnimationTarget } from './animation-player';
import { addAnimationSampling } from './animation-system';

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

    // Register the read-side importer when an AssetServer is present so a
    // standalone `.ranim` loads; glTF-produced clips arrive as sub-assets and
    // need no loader.
    const server = app.getResource(AssetServer);
    if (server !== undefined) {
      server.registerLoader('ranim', clips, createAnimationClipImporter());
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

    addAnimationSampling(app);
  }
}
