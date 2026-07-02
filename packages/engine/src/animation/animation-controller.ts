import type { Handle } from '@retro-engine/assets';

import type { AnimationClip } from './animation-clip';
import type { AnimationLayer } from './animation-layers';
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
 * What a state plays: a single clip, or a blend tree whose children are
 * themselves {@link Motion}s weighted by one (1D) or two (2D) float parameters.
 *
 * Because every child is a full motion, blend trees nest arbitrarily deep: a
 * child slot may hold another blend tree driven by a *different* parameter than
 * its parent (e.g. an outer directional `blend2d` on `moveX`/`moveY` whose slots
 * are each a `blend1d` on `speed`). A leaf is `{ kind: 'clip', clip }`. The
 * driving parameter(s) live on the blend node, so each nesting level can key off
 * its own parameter. Blend trees are motions inside a state — there is no
 * free-standing blend graph.
 */
export type Motion =
  | { readonly kind: 'clip'; readonly clip: Handle<AnimationClip> }
  | {
      readonly kind: 'blend1d';
      /** Optional author-facing name, shown when this blend is a child of another tree. */
      readonly name?: string;
      readonly parameter: string;
      readonly children: readonly { readonly motion: Motion; readonly threshold: number }[];
    }
  | {
      readonly kind: 'blend2d';
      /** Optional author-facing name, shown when this blend is a child of another tree. */
      readonly name?: string;
      readonly mode: Blend2dMode;
      readonly parameterX: string;
      readonly parameterY: string;
      readonly children: readonly { readonly motion: Motion; readonly x: number; readonly y: number }[];
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
 * One additional layer stacked on top of a controller's base state machine. The
 * controller's own `parameters`/`states`/`transitions` are the base layer
 * (index 0, always full-body at weight 1); `layers` holds the layers composited
 * above it, bottom-first. Structurally an {@link AnimationLayer} (weight, blend
 * mode, optional mask, and a clip-or-controller source) plus a display `name`.
 */
export interface ControllerLayer extends AnimationLayer {
  /** Label shown in the editor's Layers list. */
  name: string;
}

/**
 * A reusable animation state machine: parameters, states (each playing a clip or
 * blend tree), condition-driven transitions, and an optional stack of additional
 * `layers` composited over the base machine. Entity-agnostic and shareable like an
 * {@link AnimationClip} — an `AnimationControllerPlayer` binds it to a concrete
 * rig. Drives bone `Transform`s through the pose pipeline; states blend within a
 * blend tree and crossfade across a transition, and layers override/add on top.
 */
export class AnimationController {
  constructor(
    public parameters: ControllerParameter[] = [],
    public states: ControllerState[] = [],
    public transitions: Transition[] = [],
    /** Index of the state entered when a player first evaluates the controller. */
    public defaultState: number = 0,
    public name?: string,
    /** Layers composited over the base machine, bottom-first; empty for a single-layer controller. */
    public layers: ControllerLayer[] = [],
  ) {}
}

/** One clip contribution to a blend: the clip, the time to sample it at, and its weight. */
export interface MotionInput {
  readonly clip: AnimationClip;
  readonly time: number;
  readonly weight: number;
}

/**
 * Per-nesting-level scratch for {@link evaluateMotion}. A recursive blend tree
 * needs a distinct weight buffer at every depth (a parent's per-child weights
 * must survive while it recurses into each child), plus a scratch for the blend
 * node's thresholds (1D) or interleaved positions (2D). Buffers are keyed by
 * depth, grown on demand, and reused across calls — so evaluating a nested tree
 * allocates nothing on the steady-state per-frame path.
 */
export class MotionScratch {
  private readonly weightBufs: Float32Array[] = [];
  private readonly inputBufs: Float32Array[] = [];

  /** Weight-output buffer for `depth`, at least `n` long. */
  weightsAt(depth: number, n: number): Float32Array {
    let buf = this.weightBufs[depth];
    if (buf === undefined || buf.length < n) {
      buf = new Float32Array(n);
      this.weightBufs[depth] = buf;
    }
    return buf;
  }

  /** Threshold/position input buffer for `depth`, at least `len` long. */
  inputAt(depth: number, len: number): Float32Array {
    let buf = this.inputBufs[depth];
    if (buf === undefined || buf.length < len) {
      buf = new Float32Array(len);
      this.inputBufs[depth] = buf;
    }
    return buf;
  }
}

/**
 * Append a motion to `out` as weighted clip contributions, recursing through
 * nested blend trees. A clip motion yields one input weighted by `weight`; a
 * blend tree resolves its per-child weights from the driving float parameter(s)
 * via {@link weights1d}/{@link weights2d} and recurses into each child whose
 * weight is positive, scaling the incoming `weight` by the child's share. So a
 * leaf clip's final weight is the product of every blend weight along the path
 * from the state down to it, times the cross-state crossfade `weight`.
 *
 * `phase` propagates down unchanged: every leaf clip is sampled at
 * `phase × clipDuration`, keeping different-length clips synchronized by
 * normalized phase across the whole nested structure. `scratch` supplies the
 * per-depth weight and threshold/position buffers; `depth` is the current
 * nesting level (0 at the state's root motion) and grows the scratch as needed.
 */
export const evaluateMotion = (
  motion: Motion,
  phase: number,
  weight: number,
  getFloat: (name: string) => number,
  resolve: (handle: Handle<AnimationClip>) => AnimationClip | undefined,
  scratch: MotionScratch,
  out: MotionInput[],
  depth = 0,
): void => {
  if (weight <= 0) return;

  if (motion.kind === 'clip') {
    const clip = resolve(motion.clip);
    if (clip !== undefined) out.push({ clip, time: phase * clip.duration, weight });
    return;
  }

  const n = motion.children.length;
  if (n === 0) return;

  const weights = scratch.weightsAt(depth, n);
  if (motion.kind === 'blend1d') {
    const thresholds = scratch.inputAt(depth, n);
    for (let i = 0; i < n; i++) thresholds[i] = motion.children[i]!.threshold;
    weights1d(thresholds, getFloat(motion.parameter), weights);
  } else {
    const positions = scratch.inputAt(depth, n * 2);
    for (let i = 0; i < n; i++) {
      positions[i * 2] = motion.children[i]!.x;
      positions[i * 2 + 1] = motion.children[i]!.y;
    }
    weights2d(motion.mode, positions, n, getFloat(motion.parameterX), getFloat(motion.parameterY), weights);
  }

  for (let i = 0; i < n; i++) {
    const w = weights[i]!;
    if (w <= 0) continue;
    evaluateMotion(motion.children[i]!.motion, phase, weight * w, getFloat, resolve, scratch, out, depth + 1);
  }
};

/**
 * The longest leaf-clip duration anywhere in a motion — the state's
 * representative period for phase advance. Recurses through nested blend trees
 * down to the clips.
 */
export const motionDuration = (
  motion: Motion,
  resolve: (handle: Handle<AnimationClip>) => AnimationClip | undefined,
): number => {
  if (motion.kind === 'clip') return resolve(motion.clip)?.duration ?? 0;
  let max = 0;
  for (const child of motion.children) {
    const d = motionDuration(child.motion, resolve);
    if (d > max) max = d;
  }
  return max;
};
