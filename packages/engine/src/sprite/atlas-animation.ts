import type { Entity, Query as QueryHandle, World } from '@retro-engine/ecs';

import type { Time } from '../time';

import { TextureAtlas } from './texture-atlas';

/**
 * Playback mode for an {@link AtlasAnimation}.
 *
 * - `'loop'` (default) — wraps from `lastIndex` back to `firstIndex` and keeps
 *   playing forever.
 * - `'once'` — plays from `firstIndex` to `lastIndex` exactly once, then sets
 *   `paused = true` and pins the index at `lastIndex`. Mutate `paused = false`
 *   (and optionally reset `elapsedSec`) to play again.
 * - `'pingPong'` — plays forward to `lastIndex`, then backward to `firstIndex`,
 *   then forward again, alternating forever. A 4-frame range yields the
 *   sequence `0, 1, 2, 3, 2, 1, 0, 1, 2, …` — endpoints are not repeated.
 */
export type AtlasAnimationMode = 'loop' | 'once' | 'pingPong';

/**
 * Constructor options for {@link AtlasAnimation}. `firstIndex` / `lastIndex`
 * are inclusive bounds into the entity's {@link TextureAtlas}-layout's
 * `textures[]`; `fps` is the frame-advancement rate in Hz.
 */
export interface AtlasAnimationOptions {
  /** Inclusive lower bound of the animation range. */
  firstIndex: number;
  /** Inclusive upper bound of the animation range. */
  lastIndex: number;
  /** Frame-advancement rate, in Hz. `10` advances one tile every 100ms. */
  fps: number;
  /** Playback mode. Defaults to `'loop'`. */
  mode?: AtlasAnimationMode;
  /** Start paused. Defaults to `false`. */
  paused?: boolean;
}

/**
 * ECS component that drives {@link TextureAtlas.index} over time, advancing
 * through an inclusive range `[firstIndex, lastIndex]` at the configured `fps`.
 *
 * Spawn alongside `Sprite` + `TextureAtlas`:
 *
 * ```ts
 * cmd.spawn(
 *   new Sprite({ image: tilesheet }),
 *   new TextureAtlas(layout, 0),
 *   new AtlasAnimation({ firstIndex: 0, lastIndex: 7, fps: 12, mode: 'loop' }),
 *   new Transform(...),
 * );
 * ```
 *
 * The engine's `atlas-animation` system runs in `'postUpdate'` before
 * `'atlas-sync'`, so any index it writes propagates to `sprite.rect` on the
 * same frame (no one-frame visual lag). Animation is driven by
 * `Time.virtual.delta`, so pausing virtual time (`time.virtual.paused = true`)
 * also pauses every active animator.
 *
 * Set {@link paused} to `true` to short-circuit a single entity without
 * affecting others. `'once'`-mode animators self-set `paused = true` at
 * completion; resume with `paused = false` (and reset {@link elapsedSec} to
 * `0` if you want to replay from `firstIndex`).
 *
 * Ill-formed ranges (`firstIndex > lastIndex`) are silently skipped — the
 * sprite keeps whatever index it has. Reverse playback is not modelled in
 * this phase; swap `firstIndex` and `lastIndex` if you need it and pair with
 * a custom system, or wait for the full animation system.
 */
export class AtlasAnimation {
  firstIndex: number;
  lastIndex: number;
  fps: number;
  mode: AtlasAnimationMode;
  paused: boolean;
  /**
   * Seconds elapsed since the animation started (or last reset). Internal
   * state — surfaced so tests and gameplay code can introspect or reset
   * playback, but the system writes it every non-paused frame.
   */
  elapsedSec: number;

  constructor(options: AtlasAnimationOptions) {
    this.firstIndex = options.firstIndex;
    this.lastIndex = options.lastIndex;
    this.fps = options.fps;
    this.mode = options.mode ?? 'loop';
    this.paused = options.paused ?? false;
    this.elapsedSec = 0;
  }
}

/**
 * Per-frame ticker that advances {@link TextureAtlas.index} on every entity
 * carrying an {@link AtlasAnimation}.
 *
 * Registered by `SpritePlugin` in `'postUpdate'` with label `'atlas-animation'`
 * and ordering `before: ['atlas-sync']`. The ordering guarantee is
 * load-bearing: this system mutates `atlas.index` and calls
 * `world.markChanged(entity, TextureAtlas)`, then `'atlas-sync'` runs in the
 * same frame and its `Changed<TextureAtlas>` filter catches the entity, so
 * `sprite.rect` updates without a one-frame visual delay.
 *
 * The query intentionally carries no `Changed<…>` filter — every animated
 * entity is visited every frame. Per-entity cost is one float add, one
 * `floor`, one comparison; idle entities short-circuit on the `paused` check
 * at the top of the loop body. `markChanged` is only called when the computed
 * target index actually differs from the current index, so a steady-state
 * animator at <1 frame-step per tick imposes no atlas-sync work.
 *
 * Animation is driven by {@link Time.virtual.delta} (not `real`) so the
 * standard virtual-time pause/scale knobs apply uniformly — pausing the game
 * pauses all animators, slow-mo halves their effective fps, etc.
 *
 * @param time The engine clock; reads `time.virtual.delta` in seconds.
 * @param query Query handle over rows `(AtlasAnimation, TextureAtlas)`.
 * @param world The main world, used to mark `TextureAtlas` changed after
 *   each index write so the downstream atlas-sync filter fires.
 */
export const atlasAnimationSystem = (
  time: Time,
  query: QueryHandle<readonly [typeof AtlasAnimation, typeof TextureAtlas]>,
  world: World,
): void => {
  const dt = time.virtual.delta;
  for (const row of query.entries()) {
    const entity = row[0] as Entity;
    const anim = row[1] as AtlasAnimation;
    const atlas = row[2] as TextureAtlas;
    if (anim.paused) continue;
    // Ill-formed ranges silently skip rather than throw — animator state is
    // gameplay-mutable and a tooling edit shouldn't crash the frame.
    if (anim.lastIndex < anim.firstIndex) continue;

    anim.elapsedSec += dt;
    const len = anim.lastIndex - anim.firstIndex + 1;

    let target: number;
    if (len === 1) {
      // Single-frame range — nothing to advance through. Pin to firstIndex.
      target = anim.firstIndex;
    } else {
      const steps = Math.floor(anim.elapsedSec * anim.fps);
      if (anim.mode === 'loop') {
        target = anim.firstIndex + (steps % len);
      } else if (anim.mode === 'pingPong') {
        // Period 2*(len-1) — endpoints are not repeated. For len=4:
        // steps mod 6 maps to phases 0..5 → 0,1,2,3,2,1.
        const period = 2 * (len - 1);
        const phase = steps % period;
        target = phase < len
          ? anim.firstIndex + phase
          : anim.lastIndex - (phase - len + 1);
      } else {
        // 'once': clamp at lastIndex and self-pause on completion.
        if (steps >= len - 1) {
          target = anim.lastIndex;
          anim.paused = true;
        } else {
          target = anim.firstIndex + steps;
        }
      }
    }

    if (atlas.index !== target) {
      atlas.index = target;
      world.markChanged(entity, TextureAtlas);
    }
  }
};
