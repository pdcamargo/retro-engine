import type { Handle } from '@retro-engine/assets';

import type { AnimationController } from './animation-controller';

/** One named parameter value on an {@link AnimationControllerPlayer}; booleans/triggers use `0`/`1`. */
export interface PlayerParameter {
  name: string;
  value: number;
}

/**
 * Plays an {@link AnimationController} on a rig. Attach it to the entity that
 * owns the animated hierarchy (a glTF scene root); the controller's bone tracks
 * drive the descendant entities tagged with a matching {@link import('./animation-player').AnimationTarget},
 * scoped to this player.
 *
 * `controller`, `speed`, and `playing` are authored playback settings.
 * `parameters` are the named inputs that feed blend trees and transition
 * conditions — runtime-mutable by gameplay (set a `trigger`/`bool` to `1` to
 * fire it; the state machine resets a consumed trigger to `0`). Values absent
 * here fall back to the controller's declared defaults. The state-machine
 * runtime (active state, crossfade progress, per-state phase) is transient and
 * lives in a separate resource, not on this component.
 */
export class AnimationControllerPlayer {
  constructor(
    /** The controller to play. */
    public controller: Handle<AnimationController>,
    /** Playback rate multiplier applied to every state's phase advance. */
    public speed = 1,
    /** Whether playback and transitions advance. A stopped player holds its pose. */
    public playing = true,
    /** Current parameter values, overriding the controller's declared defaults. */
    public parameters: PlayerParameter[] = [],
  ) {}
}
