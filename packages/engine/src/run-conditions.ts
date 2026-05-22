import type { ComponentType } from '@retro-engine/ecs';

import { State } from './state';
import { RunCondition } from './system-param';
import { Time } from './time';

/**
 * Run only while the state type of `value` currently holds exactly `value`.
 *
 * The state type is recovered from `value.constructor`, so call sites can
 * pass the static value directly:
 *
 * ```ts
 * app.addSystem('update', [...], movePlayer, {
 *   runIf: inState(GameState.Playing),
 * });
 * ```
 *
 * Evaluation is **live** — the run condition reads `State<S>.current` each
 * time it tests. A same-frame transition that runs in `StateTransition`
 * (between `PreUpdate` and `Update`) is visible to `Update`-stage systems
 * gated by `inState(...)`. Identity is `===`, so the recommended pattern of
 * declaring states as `static readonly` singletons is required (`new
 * GameState('Playing') === GameState.Playing` is false).
 *
 * Returns `false` if the state type has not yet been registered via
 * `initState`, or if `State.current` is `undefined` (between `initState`
 * and the first `StateTransition` phase).
 *
 * Compose with the other helpers via `RunCondition`'s `.and()` / `.or()` /
 * `.not()`.
 */
export const inState = <S extends object>(value: S): RunCondition => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ctor = value.constructor as new (...args: any[]) => S;
  const StateCls = State(ctor);
  return new RunCondition((app) => {
    const state = app.getResource(StateCls);
    return state?.current === value;
  });
};

/**
 * Run only while a resource of type `ctor` is currently registered. Useful
 * for gating systems on resources that come and go — feature flags inserted
 * by a plugin's `finish` hook, state-scoped resources, optional integrations.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const resourceExists = <T>(ctor: new (...args: any[]) => T): RunCondition =>
  new RunCondition((app) => app.getResource(ctor) !== undefined);

/**
 * Run only on the **frame** during which a resource of type `ctor` was
 * inserted, replaced, or removed.
 *
 * Coarse v1 semantics — see ADR-0008 §9. **In-place mutations** (e.g. a
 * system writing through `ResMut(Foo).value = 1`) are **not** detected here;
 * the resource instance is unchanged from the App's perspective. Only the
 * insert / replace / remove operations bump the change frame.
 *
 * Same condition produces the same answer for every system in the frame —
 * there is no per-system change tick. Per-component change detection lands
 * in M3 with `Changed<T>` (`docs/roadmap/change-detection.md`).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const resourceChanged = <T>(ctor: new (...args: any[]) => T): RunCondition =>
  new RunCondition((app) => {
    const changed = app.getResourceChangeFrame(ctor);
    if (changed === undefined) return false;
    const time = app.getResource(Time);
    if (time === undefined) return false;
    return changed === time.frame;
  });

/**
 * Run only while at least one entity in the `World` has a component of type
 * `ctor`. Useful for "is there a player?" / "are any enemies alive?" gates.
 *
 * Implementation hits the query path's first-match short-circuit, so the
 * cost is one archetype lookup until a match is found.
 */
export const anyWithComponent = (ctor: ComponentType): RunCondition =>
  new RunCondition((app) => app.world.query([ctor]).first() !== undefined);
