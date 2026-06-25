import type { Entity } from '@retro-engine/ecs';

/**
 * A transient skeletal pose: per-bone local translation/rotation/scale held as a
 * structure of arrays. For `jointCount` bones, `t` and `s` carry three floats
 * per bone and `r` carries four (a quaternion `x, y, z, w`); a bone is addressed
 * by its *slot* index `0…jointCount-1`. `targets[slot]` is the bound bone entity
 * the slot is committed to.
 *
 * A `Pose` doubles as the **blend accumulator**: {@link beginAccumulate} clears
 * it, sources are added with the `accumulate*` helpers (which also tally the
 * per-field weights `wt`/`wr`/`ws`), and a final pass divides translation/scale
 * by their accumulated weight and renormalizes each quaternion. A field whose
 * weight stays zero was never animated and is left untouched on commit, so a
 * clip that drives only some bones (or only a bone's rotation) leaves the rest
 * at their authored values.
 *
 * Poses are recomputed every frame and never serialized.
 */
export class Pose {
  /** Number of active bone slots. */
  jointCount = 0;
  /** Translations, three floats per slot (`x, y, z`). */
  t: Float32Array;
  /** Rotations, four floats per slot (quaternion `x, y, z, w`). */
  r: Float32Array;
  /** Scales, three floats per slot (`x, y, z`). */
  s: Float32Array;
  /** Slot → bound bone entity, length `jointCount`. */
  readonly targets: Entity[] = [];
  /** Accumulated translation weight per slot. Zero means "no source animated it". */
  wt: Float32Array;
  /** Accumulated rotation weight per slot. */
  wr: Float32Array;
  /** Accumulated scale weight per slot. */
  ws: Float32Array;

  private capacity: number;

  constructor(capacity = 0) {
    this.capacity = capacity;
    this.t = new Float32Array(capacity * 3);
    this.r = new Float32Array(capacity * 4);
    this.s = new Float32Array(capacity * 3);
    this.wt = new Float32Array(capacity);
    this.wr = new Float32Array(capacity);
    this.ws = new Float32Array(capacity);
  }

  /**
   * Grow storage to hold at least `jointCount` slots (reallocating only when the
   * current capacity is too small), then set {@link jointCount}. Existing data is
   * not preserved across a grow — call {@link beginAccumulate} before reuse.
   */
  ensureCapacity(jointCount: number): void {
    if (jointCount > this.capacity) {
      this.capacity = jointCount;
      this.t = new Float32Array(jointCount * 3);
      this.r = new Float32Array(jointCount * 4);
      this.s = new Float32Array(jointCount * 3);
      this.wt = new Float32Array(jointCount);
      this.wr = new Float32Array(jointCount);
      this.ws = new Float32Array(jointCount);
    }
    this.jointCount = jointCount;
    this.targets.length = jointCount;
  }

  /** Reset every active slot to a zero accumulator (ready to add blend sources). */
  beginAccumulate(jointCount: number): void {
    this.ensureCapacity(jointCount);
    this.t.fill(0, 0, jointCount * 3);
    this.r.fill(0, 0, jointCount * 4);
    this.s.fill(0, 0, jointCount * 3);
    this.wt.fill(0, 0, jointCount);
    this.wr.fill(0, 0, jointCount);
    this.ws.fill(0, 0, jointCount);
  }
}

/**
 * Per-player skeletal poses for the current frame, keyed by the
 * `AnimationPlayer` / `AnimationControllerPlayer` entity. A main-world resource
 * filled in the `update` stage (sample → blend) and consumed the same stage by
 * the commit step. Transient — entries are overwritten each frame and reused
 * across frames, so this is never serialized.
 */
export class AnimationPoses {
  readonly byPlayer = new Map<Entity, Pose>();
}
