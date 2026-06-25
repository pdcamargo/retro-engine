import type { Handle } from '@retro-engine/assets';
import type { Entity } from '@retro-engine/ecs';

import type { AnimationClip } from './animation-clip';

/** What an {@link AnimationPlayer} does when its clip reaches the end. */
export type RepeatMode = 'loop' | 'once';

/**
 * Plays one {@link AnimationClip} on a rig. Attach it to the entity that owns
 * the animated hierarchy (a glTF scene root); its tracks drive the descendant
 * entities tagged with a matching {@link AnimationTarget}.
 *
 * The clip reference and playback settings (`speed`, `playing`, `repeat`) are
 * authored state and persist with a scene. `time` is the transient playback
 * cursor recomputed every frame and is not serialized.
 */
export class AnimationPlayer {
  constructor(
    /** The clip to play. */
    public clip: Handle<AnimationClip>,
    /** Playback rate multiplier; `1` is real-time, `2` double speed, negative plays backward. */
    public speed = 1,
    /** Whether the cursor advances. A stopped player holds its current pose. */
    public playing = true,
    /** What happens at the end of the clip. */
    public repeat: RepeatMode = 'loop',
    /** Current playback position in seconds. Transient — recomputed each frame, not serialized. */
    public time = 0,
  ) {}
}

/**
 * Tags an entity as an animation target bound to a specific {@link AnimationPlayer}.
 * A clip track names a `targetId`; the entity whose `AnimationTarget.id` matches,
 * and whose `player` is the playing entity, receives that track's writes. This is
 * what lets a clip be entity-agnostic (a shared asset) yet resolve to concrete
 * bones once bound to a rig instance.
 */
export class AnimationTarget {
  constructor(
    /** Stable identifier a clip track addresses (e.g. a glTF node index as a string). */
    public id: string,
    /** The {@link AnimationPlayer} entity that drives this target. */
    public player: Entity,
  ) {}
}
