import type { Handle } from '@retro-engine/assets';

import type { AnimationClip } from './animation-clip';
import type { Blend2dMode } from './blend-tree';
import { weights1d, weights2d } from './blend-tree';

/** The kind of value an {@link ControllerParameter} holds and how the state machine reads it. */
export type ParameterType = 'float' | 'bool' | 'trigger';

/**
 * A named input to an {@link AnimationController}. `float` parameters drive blend
 * trees and `gt`/`lt`/`eq`/`neq` conditions; `bool` parameters drive `eq`/`neq`
 * conditions; `trigger` parameters are booleans that the state machine consumes
 * (resets to false) when a transition they gate fires. `default` seeds the value
 * (booleans/triggers use `0`/`1`) before a player overrides it.
 */
export interface ControllerParameter {
  readonly name: string;
  readonly type: ParameterType;
  readonly default: number;
}

/**
 * What a state plays: a single clip, or a blend tree whose child clips are
 * weighted by one (1D) or two (2D) float parameters. Blend trees are motions
 * inside a state — there is no free-standing blend graph.
 */
export type Motion =
  | { readonly kind: 'clip'; readonly clip: Handle<AnimationClip> }
  | {
      readonly kind: 'blend1d';
      readonly parameter: string;
      readonly children: readonly { readonly clip: Handle<AnimationClip>; readonly threshold: number }[];
    }
  | {
      readonly kind: 'blend2d';
      readonly mode: Blend2dMode;
      readonly parameterX: string;
      readonly parameterY: string;
      readonly children: readonly {
        readonly clip: Handle<AnimationClip>;
        readonly x: number;
        readonly y: number;
      }[];
    };

/** One state in the machine: a name and the {@link Motion} it plays, with an optional speed multiplier. */
export interface ControllerState {
  readonly name: string;
  readonly motion: Motion;
  readonly speed?: number;
}

/** A condition operator evaluated against a parameter; `trigger` matches a set trigger/bool. */
export type ConditionOp = 'gt' | 'lt' | 'eq' | 'neq' | 'trigger';

/** One predicate on a transition: `parameter op value`. `value` is unused for `trigger`. */
export interface TransitionCondition {
  readonly parameter: string;
  readonly op: ConditionOp;
  readonly value: number;
}

/**
 * A directed edge between states. Fires when all `conditions` hold (and, when
 * `hasExitTime`, once the source state's normalized phase reaches `exitTime`),
 * crossfading to `to` over `duration` seconds. `from` is the source state index,
 * or `-1` for an "any state" transition that can fire regardless of the current
 * state.
 */
export interface Transition {
  readonly from: number;
  readonly to: number;
  readonly conditions: readonly TransitionCondition[];
  readonly duration: number;
  readonly hasExitTime: boolean;
  readonly exitTime: number;
}

/**
 * A reusable animation state machine: parameters, states (each playing a clip or
 * blend tree), and condition-driven transitions. Entity-agnostic and shareable
 * like an {@link AnimationClip} — an `AnimationControllerPlayer` binds it to a
 * concrete rig. Drives bone `Transform`s through the pose pipeline; states blend
 * within a blend tree and crossfade across a transition.
 */
export class AnimationController {
  constructor(
    public parameters: ControllerParameter[] = [],
    public states: ControllerState[] = [],
    public transitions: Transition[] = [],
    /** Index of the state entered when a player first evaluates the controller. */
    public defaultState: number = 0,
    public name?: string,
  ) {}
}

/** One clip contribution to a blend: the clip, the time to sample it at, and its weight. */
export interface MotionInput {
  readonly clip: AnimationClip;
  readonly time: number;
  readonly weight: number;
}

/**
 * Append a state's motion to `out` as weighted clip contributions. A clip motion
 * yields one input; a blend tree resolves its child weights from the float
 * parameter(s) via {@link weights1d}/{@link weights2d}, dropping zero-weight
 * children. Each clip is sampled at `phase × clipDuration`, so different-length
 * clips in one blend tree stay synchronized by normalized phase. `stateWeight`
 * scales every contribution (the cross-state crossfade weight). `weightScratch`
 * must be at least as long as the largest child count and is reused across calls.
 */
export const evaluateMotion = (
  motion: Motion,
  phase: number,
  stateWeight: number,
  getFloat: (name: string) => number,
  resolve: (handle: Handle<AnimationClip>) => AnimationClip | undefined,
  weightScratch: Float32Array,
  out: MotionInput[],
): void => {
  if (stateWeight <= 0) return;

  if (motion.kind === 'clip') {
    const clip = resolve(motion.clip);
    if (clip !== undefined) out.push({ clip, time: phase * clip.duration, weight: stateWeight });
    return;
  }

  const n = motion.children.length;
  if (n === 0) return;

  if (motion.kind === 'blend1d') {
    const thresholds: number[] = [];
    for (let i = 0; i < n; i++) thresholds.push(motion.children[i]!.threshold);
    weights1d(thresholds, getFloat(motion.parameter), weightScratch);
  } else {
    const positions = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      positions[i * 2] = motion.children[i]!.x;
      positions[i * 2 + 1] = motion.children[i]!.y;
    }
    weights2d(
      motion.mode,
      positions,
      n,
      getFloat(motion.parameterX),
      getFloat(motion.parameterY),
      weightScratch,
    );
  }

  // Both blend kinds share the `clip` field; weights are positional.
  for (let i = 0; i < n; i++) {
    const w = weightScratch[i]!;
    if (w <= 0) continue;
    const clip = resolve(motion.children[i]!.clip);
    if (clip !== undefined) {
      out.push({ clip, time: phase * clip.duration, weight: stateWeight * w });
    }
  }
};

/** The longest clip duration across a motion's clips — the state's representative period for phase advance. */
export const motionDuration = (
  motion: Motion,
  resolve: (handle: Handle<AnimationClip>) => AnimationClip | undefined,
): number => {
  if (motion.kind === 'clip') return resolve(motion.clip)?.duration ?? 0;
  let max = 0;
  for (const child of motion.children) {
    const d = resolve(child.clip)?.duration ?? 0;
    if (d > max) max = d;
  }
  return max;
};
