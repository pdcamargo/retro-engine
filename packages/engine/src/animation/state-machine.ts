import type { Entity } from '@retro-engine/ecs';

import type { AnimationController, Transition, TransitionCondition } from './animation-controller';

/**
 * Per-player runtime state of a state machine: the active state, an in-progress
 * crossfade (if any), and a normalized playback phase per state. Transient —
 * recomputed each frame, held in {@link import('./pose').AnimationPoses}'s sibling
 * runtime resource, never serialized.
 */
export interface ControllerRuntime {
  /** Index of the active (destination) state, or `-1` before first evaluation. */
  currentState: number;
  /** Source state of an in-progress crossfade, or `-1` when not transitioning. */
  fromState: number;
  /** Seconds elapsed into the active crossfade. */
  transitionElapsed: number;
  /** Total crossfade duration in seconds. */
  transitionDuration: number;
  /** Normalized playback phase `[0, 1)` per state index. */
  phase: number[];
}

/**
 * Per-player state-machine runtimes for the current frame, keyed by the
 * `AnimationControllerPlayer` entity. A main-world resource holding the active
 * state, crossfade progress, and per-state phase across frames. Transient —
 * never serialized; rebuilt for a player whose controller's state count changes.
 */
export class AnimationControllerRuntimes {
  readonly byPlayer = new Map<Entity, ControllerRuntime>();
}

/** Create a fresh, uninitialized runtime for a controller with `stateCount` states. */
export const createControllerRuntime = (stateCount: number): ControllerRuntime => ({
  currentState: -1,
  fromState: -1,
  transitionElapsed: 0,
  transitionDuration: 0,
  phase: Array.from({ length: stateCount }, () => 0),
});

/**
 * Read/consume access to a player's parameter values. All parameters are numeric
 * (booleans and triggers use `0`/`1`); {@link reset} sets a trigger back to `0`
 * after the transition it gated has fired.
 */
export interface ParameterAccess {
  get(name: string): number;
  reset(name: string): void;
}

const conditionMet = (cond: TransitionCondition, params: ParameterAccess): boolean => {
  const v = params.get(cond.parameter);
  switch (cond.op) {
    case 'gt':
      return v > cond.value;
    case 'lt':
      return v < cond.value;
    case 'eq':
      return v === cond.value;
    case 'neq':
      return v !== cond.value;
    case 'trigger':
      return v !== 0;
  }
};

const allConditionsMet = (
  conditions: readonly TransitionCondition[],
  params: ParameterAccess,
): boolean => {
  for (const c of conditions) if (!conditionMet(c, params)) return false;
  return true;
};

const advancePhase = (
  controller: AnimationController,
  runtime: ControllerRuntime,
  stateIndex: number,
  deltaSeconds: number,
  durationOf: (stateIndex: number) => number,
): void => {
  const dur = durationOf(stateIndex);
  if (dur <= 0) {
    runtime.phase[stateIndex] = 0;
    return;
  }
  const speed = controller.states[stateIndex]?.speed ?? 1;
  let p = runtime.phase[stateIndex]! + (deltaSeconds * speed) / dur;
  p -= Math.floor(p); // wrap into [0, 1) for both forward and reverse playback
  runtime.phase[stateIndex] = p;
};

const startTransition = (runtime: ControllerRuntime, tr: Transition): void => {
  runtime.fromState = runtime.currentState;
  runtime.currentState = tr.to;
  runtime.transitionElapsed = 0;
  runtime.transitionDuration = Math.max(0, tr.duration);
  runtime.phase[tr.to] = 0;
  if (runtime.transitionDuration === 0) runtime.fromState = -1; // instant switch
};

const selectTransition = (
  controller: AnimationController,
  runtime: ControllerRuntime,
  params: ParameterAccess,
): Transition | undefined => {
  for (const tr of controller.transitions) {
    if (tr.from !== -1 && tr.from !== runtime.currentState) continue;
    if (tr.to === runtime.currentState) continue;
    if (tr.hasExitTime && runtime.phase[runtime.currentState]! < tr.exitTime) continue;
    if (!allConditionsMet(tr.conditions, params)) continue;
    for (const c of tr.conditions) if (c.op === 'trigger') params.reset(c.parameter);
    return tr;
  }
  return undefined;
};

/**
 * Advance the state machine by `deltaSeconds`: initialize to the default state on
 * first run, advance the active (and transitioning-out) states' phases, progress
 * any crossfade, and — when not already transitioning — fire the first eligible
 * transition (its conditions met and, if it has an exit time, the source phase
 * past it), consuming any trigger it gated. `durationOf` gives a state's
 * representative clip period for phase normalization.
 */
export const stepController = (
  controller: AnimationController,
  runtime: ControllerRuntime,
  params: ParameterAccess,
  deltaSeconds: number,
  durationOf: (stateIndex: number) => number,
): void => {
  if (controller.states.length === 0) return;
  if (runtime.currentState < 0) {
    runtime.currentState = Math.min(Math.max(controller.defaultState, 0), controller.states.length - 1);
  }

  advancePhase(controller, runtime, runtime.currentState, deltaSeconds, durationOf);
  if (runtime.fromState >= 0) {
    advancePhase(controller, runtime, runtime.fromState, deltaSeconds, durationOf);
    runtime.transitionElapsed += deltaSeconds;
    if (runtime.transitionElapsed >= runtime.transitionDuration) {
      runtime.fromState = -1;
      runtime.transitionElapsed = 0;
      runtime.transitionDuration = 0;
    }
  }

  if (runtime.fromState < 0) {
    const fired = selectTransition(controller, runtime, params);
    if (fired !== undefined) startTransition(runtime, fired);
  }
};

/**
 * Cross-state blend weights for the current frame: during a crossfade the
 * destination ramps `0 → 1` and the source `1 → 0`; otherwise the current state
 * has full weight.
 */
export const stateWeights = (runtime: ControllerRuntime): { current: number; from: number } => {
  if (runtime.fromState < 0 || runtime.transitionDuration <= 0) return { current: 1, from: 0 };
  let t = runtime.transitionElapsed / runtime.transitionDuration;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  return { current: t, from: 1 - t };
};
