import type { Vec2 } from '@retro-engine/math';
import { vec2 } from '@retro-engine/math';

import { Transform, GlobalTransform } from '../transform';
import { InheritedVisibility, ViewVisibility, Visibility } from '../visibility';

/** A single occluder edge as a pair of local-space endpoints `[a, b]`. */
export type OccluderSegment = readonly [Vec2, Vec2];

/**
 * Options accepted by the {@link LightOccluder2d} constructor.
 */
export interface LightOccluder2dOptions {
  /** Local-space line segments that block light. Transformed by the entity's `GlobalTransform` each frame. */
  segments?: ReadonlyArray<OccluderSegment>;
}

/**
 * ECS component marking an entity as a 2D light occluder — a set of line
 * segments that cast shadows for `PointLight2d` and `SpotLight2d`.
 *
 * Segments are stored in the entity's local space and transformed to world
 * space by its `GlobalTransform` when shadows are built, so moving / rotating /
 * scaling the entity moves its occluder. A closed polygon is just a loop of
 * segments — use {@link LightOccluder2d.fromPolygon} for that common case, or
 * {@link LightOccluder2d.rect} for an axis-aligned box.
 *
 * Requires `Transform`, `GlobalTransform`, `Visibility`, `InheritedVisibility`,
 * and `ViewVisibility` — an invisible occluder casts no shadow. Occluders only
 * have an effect when a `Light2dPlugin` is installed.
 *
 * @example
 * ```ts
 * import { LightOccluder2d, Transform } from '@retro-engine/engine';
 * import { vec3 } from '@retro-engine/math';
 *
 * cmd.spawn(
 *   LightOccluder2d.rect(64, 64),
 *   new Transform(vec3.create(120, 0, 0)),
 * );
 * ```
 */
export class LightOccluder2d {
  segments: ReadonlyArray<OccluderSegment>;

  constructor(options: LightOccluder2dOptions = {}) {
    this.segments = options.segments ?? [];
  }

  /**
   * Build an occluder from a polygon's corner points. When `closed` (the
   * default) the last point is joined back to the first.
   */
  static fromPolygon(points: ReadonlyArray<Vec2>, closed = true): LightOccluder2d {
    const segments: OccluderSegment[] = [];
    for (let i = 0; i < points.length - 1; i++) {
      segments.push([points[i] as Vec2, points[i + 1] as Vec2]);
    }
    if (closed && points.length > 2) {
      segments.push([points[points.length - 1] as Vec2, points[0] as Vec2]);
    }
    return new LightOccluder2d({ segments });
  }

  /** Build an axis-aligned rectangular occluder of the given half-extents, centred on the entity. */
  static rect(halfWidth: number, halfHeight: number): LightOccluder2d {
    return LightOccluder2d.fromPolygon([
      vec2.create(-halfWidth, -halfHeight),
      vec2.create(halfWidth, -halfHeight),
      vec2.create(halfWidth, halfHeight),
      vec2.create(-halfWidth, halfHeight),
    ]);
  }

  static readonly requires = [
    Transform,
    GlobalTransform,
    Visibility,
    InheritedVisibility,
    ViewVisibility,
  ];
}
