import type { Handle } from '@retro-engine/assets';
import type { Entity } from '@retro-engine/ecs';

import type { AnimationClip } from './animation-clip';
import type { AnimationController } from './animation-controller';
import type { PlayerParameter } from './animation-controller-player';
import type { AvatarMask } from './avatar-mask';
import type { ControllerRuntime } from './state-machine';

/**
 * How a layer combines with the layers beneath it. `override` blends toward the
 * layer's pose by its weight (the upper layer wins as weight rises); `additive`
 * adds the layer's delta-from-reference on top, leaving the layers below at full
 * strength.
 */
export type LayerBlendMode = 'override' | 'additive';

/**
 * What drives a single layer: a looping (or one-shot) clip, or a full animation
 * controller (state machine + blend trees). A clip layer is the cheap common
 * case (a base bob, an additive breath); a controller layer hosts its own state
 * machine, so a layer can be as rich as a standalone `AnimationControllerPlayer`.
 */
export type LayerSource =
  | {
      readonly kind: 'clip';
      /** The clip this layer plays. */
      clip: Handle<AnimationClip>;
      /** Playback rate multiplier. */
      speed: number;
      /** Whether playback advances; a stopped layer holds its pose. */
      playing: boolean;
      /** Loop the clip or play it once and hold the final pose. */
      repeat: 'loop' | 'once';
    }
  | {
      readonly kind: 'controller';
      /** The controller this layer plays. */
      controller: Handle<AnimationController>;
      /** Playback rate multiplier applied to the controller's phase advance. */
      speed: number;
      /** Whether the state machine advances. */
      playing: boolean;
      /** Parameter values feeding this layer's blend trees and transitions. */
      parameters: PlayerParameter[];
    };

/** One layer in an {@link AnimationLayers} stack. */
export interface AnimationLayer {
  /** Contribution of this layer, `0…1`. */
  weight: number;
  /** Override vs additive blend against the layers beneath. */
  blend: LayerBlendMode;
  /** Optional mask scoping which bones this layer may write; absent means full body. */
  mask?: Handle<AvatarMask> | undefined;
  /** The motion driving this layer. */
  source: LayerSource;
}

/**
 * A stack of animation layers played on a rig, blended bottom-up into a single
 * pose and committed to the bound bones once per frame. Attach it to the entity
 * that owns the animated hierarchy (a glTF scene root); each layer drives the
 * descendant entities tagged with a matching
 * {@link import('./animation-player').AnimationTarget} scoped to this player,
 * masked per layer.
 *
 * `layers[0]` is the base (evaluated first); each later layer overrides or adds
 * onto the accumulated pose, scoped by its mask. This composes with — and is
 * independent of — the single-clip `AnimationPlayer` and the single-controller
 * `AnimationControllerPlayer`: an entity uses whichever surface fits. Per-layer
 * playback runtime (clip cursor, controller state) is transient and lives in
 * {@link AnimationLayerRuntimes}, not on this component.
 */
export class AnimationLayers {
  constructor(
    /** The layer stack, bottom (base) first. */
    public layers: AnimationLayer[] = [],
  ) {}
}

/** Transient per-layer playback state: a clip cursor and/or a controller runtime. */
export interface LayerRuntime {
  /** Clip playback cursor in seconds (clip layers). */
  time: number;
  /** State-machine runtime (controller layers); created lazily. */
  controller?: ControllerRuntime;
}

/**
 * Per-player per-layer playback runtimes for the current frame, keyed by the
 * {@link AnimationLayers} entity and parallel to its `layers` array. A main-world
 * resource holding clip cursors and controller state across frames. Transient —
 * never serialized; rebuilt when a player's layer count changes.
 */
export class AnimationLayerRuntimes {
  readonly byPlayer = new Map<Entity, LayerRuntime[]>();
}

/**
 * Per-player reference (bind/rest) pose for additive layers, keyed by the
 * {@link AnimationLayers} entity and, within it, by bone target id. Each entry is
 * ten floats — translation (3), rotation quaternion (4), scale (3) — captured
 * lazily from a bone's local `Transform` the first frame it is seen, before any
 * layer writes it. For a glTF-instantiated rig that is the bind pose. Transient,
 * derived state — never serialized.
 */
export class ReferencePoses {
  readonly byPlayer = new Map<Entity, Map<string, Float32Array>>();
}
