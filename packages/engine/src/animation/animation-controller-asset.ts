import type { AssetGuid, AssetImporter, AssetSerializer, Handle } from '@retro-engine/assets';
import { Assets } from '@retro-engine/assets';

import type { AnimationClip } from './animation-clip';
import type { AnimationClips } from './animation-clip-asset';
import type { Blend2dMode } from './blend-tree';
import {
  AnimationController,
  type ControllerParameter,
  type ControllerState,
  type Motion,
  type Transition,
} from './animation-controller';

/** The {@link Assets} store holding imported/authored {@link AnimationController}s. */
export class AnimationControllers extends Assets<AnimationController> {}

/** Asset-kind tag and file extension for {@link AnimationController}. */
export const ANIMATION_CONTROLLER_ASSET_KIND = 'AnimationController';

/** Current `.ranimctrl` wire-format version. Bumped only on a breaking shape change. */
export const ANIMATION_CONTROLLER_FORMAT_VERSION = 2;

// A motion's leaf clip handles are written by GUID and resolved back through the
// AnimationClips store on load, so a controller round-trips independently of the
// runtime slot a clip happens to occupy. Blend children carry a full nested
// motion (which may itself be a blend tree), so the whole recursive structure is
// serialized and clip handles are emitted/resolved only at the leaves.
type SerializedMotion =
  | { readonly kind: 'clip'; readonly clip: string }
  | {
      readonly kind: 'blend1d';
      readonly parameter: string;
      readonly children: readonly { readonly motion: SerializedMotion; readonly threshold: number }[];
    }
  | {
      readonly kind: 'blend2d';
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

interface AnimationControllerFile {
  readonly version: number;
  readonly name?: string;
  readonly defaultState: number;
  readonly parameters: readonly ControllerParameter[];
  readonly states: readonly SerializedState[];
  readonly transitions: readonly Transition[];
}

const guidOf = (handle: Handle<AnimationClip>): string => {
  if (handle.guid === undefined) {
    throw new Error('AnimationController: a clip handle has no GUID and cannot be serialized');
  }
  return handle.guid;
};

const encodeMotion = (motion: Motion): SerializedMotion => {
  if (motion.kind === 'clip') return { kind: 'clip', clip: guidOf(motion.clip) };
  if (motion.kind === 'blend1d') {
    return {
      kind: 'blend1d',
      parameter: motion.parameter,
      children: motion.children.map((c) => ({ motion: encodeMotion(c.motion), threshold: c.threshold })),
    };
  }
  return {
    kind: 'blend2d',
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
      parameter: motion.parameter,
      children: motion.children.map((c) => ({ motion: decodeMotion(c.motion, clips), threshold: c.threshold })),
    };
  }
  return {
    kind: 'blend2d',
    mode: motion.mode,
    parameterX: motion.parameterX,
    parameterY: motion.parameterY,
    children: motion.children.map((c) => ({ motion: decodeMotion(c.motion, clips), x: c.x, y: c.y })),
  };
};

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
  };
  return new TextEncoder().encode(JSON.stringify(file));
};

const decodeController = (bytes: Uint8Array, clips: AnimationClips): AnimationController => {
  const raw = JSON.parse(new TextDecoder().decode(bytes)) as Partial<AnimationControllerFile>;
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
  return new AnimationController(
    [...(raw.parameters ?? [])],
    states,
    [...(raw.transitions ?? [])] as Transition[],
    raw.defaultState ?? 0,
    raw.name,
  );
};

/**
 * Build the {@link AssetImporter} that turns `.ranimctrl` bytes (UTF-8 JSON) into
 * an {@link AnimationController}, resolving each motion's clip GUID through
 * `clips`. An unresolved clip GUID reserves a slot so a later-loaded clip with
 * that identity fills it.
 */
export const createAnimationControllerImporter = (
  clips: AnimationClips,
): AssetImporter<AnimationController> => (bytes) => decodeController(bytes, clips);

/**
 * Build the {@link AssetSerializer} that round-trips an {@link AnimationController}
 * through its canonical `.ranimctrl` JSON form, encoding clip references by GUID
 * and resolving them back through `clips`.
 */
export const createAnimationControllerSerializer = (
  clips: AnimationClips,
): AssetSerializer<AnimationController> => ({
  serialize: (controller) => encodeController(controller),
  deserialize: (bytes) => decodeController(bytes, clips),
});
