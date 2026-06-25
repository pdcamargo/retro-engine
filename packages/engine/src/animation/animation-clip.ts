import type { FieldPath } from '@retro-engine/reflect';

/**
 * How a sampler interpolates between two keyframes, matching the glTF 2.0
 * interpolation modes:
 *
 * - `LINEAR` — straight-line blend; rotations (quaternions) are interpolated
 *   spherically (shortest-path slerp), vectors and scalars component-wise.
 * - `STEP` — hold the previous keyframe's value with no blend.
 * - `CUBICSPLINE` — cubic Hermite spline; each keyframe carries an in- and
 *   out-tangent, so the sampler reads three values per keyframe (see
 *   {@link KeyframeSampler.values}).
 */
export type Interpolation = 'LINEAR' | 'STEP' | 'CUBICSPLINE';

/**
 * The keyframe data for one track: parallel `times`/`values` arrays plus the
 * interpolation mode. `componentCount` is the number of scalar components in one
 * sampled value (1 for a number, 3 for a vec3, 4 for a vec4/quat); it is the
 * *logical* width regardless of interpolation.
 */
export interface KeyframeSampler {
  /** Keyframe timestamps in seconds, strictly increasing. Length = keyframe count. */
  readonly times: Float32Array;
  /**
   * Flat keyframe values. For `LINEAR`/`STEP` the stride is `componentCount`
   * (value `i` at `i × componentCount`). For `CUBICSPLINE` the stride is
   * `3 × componentCount`, laid out `[inTangent, value, outTangent]` per keyframe
   * — the value of keyframe `i` is at `i × 3 × componentCount + componentCount`.
   */
  readonly values: Float32Array;
  /** Logical components per sampled value: 1 scalar, 3 vec3, 4 vec4/quat. */
  readonly componentCount: number;
  /** How values between keyframes are blended. */
  readonly interpolation: Interpolation;
}

/**
 * What a track drives: a property on a component of some entity. The entity is
 * not named directly — `targetId` binds to the `AnimationTarget.id` of an entity
 * scoped to the playing `AnimationPlayer`, so one clip plays on any instance of a
 * matching rig. `component` is a registered component's stable reflection name
 * and `path` the reflected field path within it, so a track can address any
 * reflected property, not just a transform.
 */
export interface TrackTarget {
  /** Binds to the {@link AnimationTarget} `id` of the entity this track drives. */
  readonly targetId: string;
  /** Stable reflection name of the component the property lives on (e.g. `'Transform'`). */
  readonly component: string;
  /** Reflected property path within `component` (e.g. `translation`, `rotation`). */
  readonly path: FieldPath;
}

/** One animated property: where it writes ({@link TrackTarget}) and its keyframes ({@link KeyframeSampler}). */
export interface AnimationTrack {
  readonly target: TrackTarget;
  readonly sampler: KeyframeSampler;
}

/**
 * A reusable keyframe animation: a set of tracks, each driving one reflected
 * property over time. Not skeletal-specific — skeletal animation is the case
 * where tracks happen to target bone `Transform` translation/rotation/scale.
 * Played by an `AnimationPlayer`, which advances a time cursor and samples each
 * track into its bound entity's component.
 */
export class AnimationClip {
  constructor(
    /** The animated properties. */
    public tracks: AnimationTrack[] = [],
    /** Clip length in seconds — the latest keyframe time across all tracks. */
    public duration: number = 0,
    /** Optional human-readable name (e.g. the glTF animation name). */
    public name?: string,
  ) {}
}

/** The latest keyframe time across `tracks`, i.e. a clip's natural duration in seconds. */
export const clipDuration = (tracks: readonly AnimationTrack[]): number => {
  let max = 0;
  for (const track of tracks) {
    const { times } = track.sampler;
    if (times.length > 0) max = Math.max(max, times[times.length - 1]!);
  }
  return max;
};
