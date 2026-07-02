import type { AssetGuid, AssetImporter, AssetSerializer, Handle } from '@retro-engine/assets';
import { Assets } from '@retro-engine/assets';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

import type { AnimationClip } from './animation-clip';
import type { AnimationClips } from './animation-clip-asset';
import {
  AnimationController,
  type ControllerLayer,
  type ControllerParameter,
  type ControllerState,
  type Motion,
  type Transition,
} from './animation-controller';
import type { PlayerParameter } from './animation-controller-player';
import type { LayerBlendMode, LayerSource } from './animation-layers';
import type { AvatarMasks } from './avatar-mask-asset';
import type { Blend2dMode } from './blend-tree';

/** The {@link Assets} store holding imported/authored {@link AnimationController}s. */
export class AnimationControllers extends Assets<AnimationController> {}

/** Asset-kind tag and file extension for {@link AnimationController}. */
export const ANIMATION_CONTROLLER_ASSET_KIND = 'AnimationController';

/** Current `.ranimctrl` wire-format version. Bumped only on a breaking shape change. */
export const ANIMATION_CONTROLLER_FORMAT_VERSION = 3;

// A motion's leaf clip handles are written by GUID and resolved back through the
// AnimationClips store on load, so a controller round-trips independently of the
// runtime slot a clip happens to occupy. Blend children carry a full nested
// motion (which may itself be a blend tree), so the whole recursive structure is
// serialized and clip handles are emitted/resolved only at the leaves.
type SerializedMotion =
  | { readonly kind: 'clip'; readonly clip: string }
  | {
      readonly kind: 'blend1d';
      readonly name?: string;
      readonly parameter: string;
      readonly children: readonly { readonly motion: SerializedMotion; readonly threshold: number }[];
    }
  | {
      readonly kind: 'blend2d';
      readonly name?: string;
      readonly mode: Blend2dMode;
      readonly parameterX: string;
      readonly parameterY: string;
      readonly children: readonly { readonly motion: SerializedMotion; readonly x: number; readonly y: number }[];
    };

interface SerializedState {
  readonly name: string;
  readonly motion: SerializedMotion;
  readonly speed?: number;
}

// A layer's clip / controller / mask references are written by GUID and resolved
// back through their stores on load, mirroring how a motion's leaf clips round-trip.
type SerializedLayerSource =
  | { readonly kind: 'clip'; readonly clip: string; readonly speed: number; readonly playing: boolean; readonly repeat: 'loop' | 'once' }
  | { readonly kind: 'controller'; readonly controller: string; readonly speed: number; readonly playing: boolean; readonly parameters: readonly PlayerParameter[] };

interface SerializedLayer {
  readonly name: string;
  readonly weight: number;
  readonly blend: LayerBlendMode;
  readonly mask?: string;
  readonly source: SerializedLayerSource;
}

interface AnimationControllerFile {
  readonly version: number;
  readonly name?: string;
  readonly defaultState: number;
  readonly parameters: readonly ControllerParameter[];
  readonly states: readonly SerializedState[];
  readonly transitions: readonly Transition[];
  readonly layers?: readonly SerializedLayer[];
}

const guidOf = (handle: Handle<unknown>): string => {
  if (handle.guid === undefined) {
    throw new Error('AnimationController: a handle has no GUID and cannot be serialized');
  }
  return handle.guid;
};

const encodeMotion = (motion: Motion): SerializedMotion => {
  if (motion.kind === 'clip') return { kind: 'clip', clip: guidOf(motion.clip) };
  if (motion.kind === 'blend1d') {
    return {
      kind: 'blend1d',
      ...(motion.name !== undefined ? { name: motion.name } : {}),
      parameter: motion.parameter,
      children: motion.children.map((c) => ({ motion: encodeMotion(c.motion), threshold: c.threshold })),
    };
  }
  return {
    kind: 'blend2d',
    ...(motion.name !== undefined ? { name: motion.name } : {}),
    mode: motion.mode,
    parameterX: motion.parameterX,
    parameterY: motion.parameterY,
    children: motion.children.map((c) => ({ motion: encodeMotion(c.motion), x: c.x, y: c.y })),
  };
};

const decodeMotion = (motion: SerializedMotion, clips: AnimationClips): Motion => {
  const resolve = (guid: string): Handle<AnimationClip> =>
    clips.handleByGuid(guid as AssetGuid) ?? clips.reserveHandle(guid as AssetGuid);
  if (motion.kind === 'clip') return { kind: 'clip', clip: resolve(motion.clip) };
  if (motion.kind === 'blend1d') {
    return {
      kind: 'blend1d',
      ...(motion.name !== undefined ? { name: motion.name } : {}),
      parameter: motion.parameter,
      children: motion.children.map((c) => ({ motion: decodeMotion(c.motion, clips), threshold: c.threshold })),
    };
  }
  return {
    kind: 'blend2d',
    ...(motion.name !== undefined ? { name: motion.name } : {}),
    mode: motion.mode,
    parameterX: motion.parameterX,
    parameterY: motion.parameterY,
    children: motion.children.map((c) => ({ motion: decodeMotion(c.motion, clips), x: c.x, y: c.y })),
  };
};

const encodeLayerSource = (source: LayerSource): SerializedLayerSource =>
  source.kind === 'clip'
    ? { kind: 'clip', clip: guidOf(source.clip), speed: source.speed, playing: source.playing, repeat: source.repeat }
    : {
        kind: 'controller',
        controller: guidOf(source.controller),
        speed: source.speed,
        playing: source.playing,
        parameters: source.parameters.map((p) => ({ name: p.name, value: p.value })),
      };

const encodeLayer = (layer: ControllerLayer): SerializedLayer => ({
  name: layer.name,
  weight: layer.weight,
  blend: layer.blend,
  ...(layer.mask !== undefined ? { mask: guidOf(layer.mask) } : {}),
  source: encodeLayerSource(layer.source),
});

const decodeLayerSource = (
  source: SerializedLayerSource,
  clips: AnimationClips,
  controllers: AnimationControllers,
): LayerSource =>
  source.kind === 'clip'
    ? {
        kind: 'clip',
        clip: clips.handleByGuid(source.clip as AssetGuid) ?? clips.reserveHandle(source.clip as AssetGuid),
        speed: source.speed,
        playing: source.playing,
        repeat: source.repeat,
      }
    : {
        kind: 'controller',
        controller:
          controllers.handleByGuid(source.controller as AssetGuid) ??
          controllers.reserveHandle(source.controller as AssetGuid),
        speed: source.speed,
        playing: source.playing,
        parameters: source.parameters.map((p) => ({ name: p.name, value: p.value })),
      };

const decodeLayer = (
  layer: SerializedLayer,
  clips: AnimationClips,
  controllers: AnimationControllers,
  masks: AvatarMasks,
): ControllerLayer => ({
  name: layer.name,
  weight: layer.weight,
  blend: layer.blend,
  ...(layer.mask !== undefined
    ? { mask: masks.handleByGuid(layer.mask as AssetGuid) ?? masks.reserveHandle(layer.mask as AssetGuid) }
    : {}),
  source: decodeLayerSource(layer.source, clips, controllers),
});

const encodeController = (controller: AnimationController): Uint8Array => {
  const file: AnimationControllerFile = {
    version: ANIMATION_CONTROLLER_FORMAT_VERSION,
    ...(controller.name !== undefined ? { name: controller.name } : {}),
    defaultState: controller.defaultState,
    parameters: controller.parameters,
    states: controller.states.map((s) => ({
      name: s.name,
      motion: encodeMotion(s.motion),
      ...(s.speed !== undefined ? { speed: s.speed } : {}),
    })),
    transitions: controller.transitions,
    ...(controller.layers.length > 0 ? { layers: controller.layers.map(encodeLayer) } : {}),
  };
  return new TextEncoder().encode(stringifyYaml(file));
};

const decodeController = (
  bytes: Uint8Array,
  clips: AnimationClips,
  controllers: AnimationControllers,
  masks: AvatarMasks,
): AnimationController => {
  const raw = parseYaml(new TextDecoder().decode(bytes)) as Partial<AnimationControllerFile>;
  if (raw.version !== ANIMATION_CONTROLLER_FORMAT_VERSION) {
    throw new Error(
      `AnimationController: unsupported format version ${String(raw.version)} (expected ${ANIMATION_CONTROLLER_FORMAT_VERSION})`,
    );
  }
  const states: ControllerState[] = (raw.states ?? []).map((s) => ({
    name: s.name,
    motion: decodeMotion(s.motion, clips),
    ...(s.speed !== undefined ? { speed: s.speed } : {}),
  }));
  const layers: ControllerLayer[] = (raw.layers ?? []).map((l) => decodeLayer(l, clips, controllers, masks));
  return new AnimationController(
    [...(raw.parameters ?? [])],
    states,
    [...(raw.transitions ?? [])] as Transition[],
    raw.defaultState ?? 0,
    raw.name,
    layers,
  );
};

/**
 * Build the {@link AssetImporter} that turns `.ranimctrl` bytes (UTF-8 YAML) into
 * an {@link AnimationController}, resolving each motion's clip GUID through `clips`
 * and each layer's controller / mask GUID through `controllers` / `masks`. An
 * unresolved GUID reserves a slot so a later-loaded asset with that identity fills
 * it.
 */
export const createAnimationControllerImporter = (
  clips: AnimationClips,
  controllers: AnimationControllers,
  masks: AvatarMasks,
): AssetImporter<AnimationController> => (bytes) => decodeController(bytes, clips, controllers, masks);

/**
 * Build the {@link AssetSerializer} that round-trips an {@link AnimationController}
 * through its canonical `.ranimctrl` YAML form, encoding clip / controller / mask
 * references by GUID and resolving them back through the given stores.
 */
export const createAnimationControllerSerializer = (
  clips: AnimationClips,
  controllers: AnimationControllers,
  masks: AvatarMasks,
): AssetSerializer<AnimationController> => ({
  serialize: (controller) => encodeController(controller),
  deserialize: (bytes) => decodeController(bytes, clips, controllers, masks),
});
