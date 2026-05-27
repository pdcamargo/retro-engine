import type { Vec2, Vec3 } from '@retro-engine/math';
import { vec3 } from '@retro-engine/math';

import { Transform, GlobalTransform } from '../transform';
import { InheritedVisibility, ViewVisibility, Visibility } from '../visibility';

/**
 * Options accepted by the {@link AmbientLight2d} constructor. Every field is
 * optional; omitted fields take the documented default.
 */
export interface AmbientLight2dOptions {
  /** RGB tint of the ambient contribution. Linear-space colour. Default `(1, 1, 1)`. */
  color?: Vec3;
  /** Unitless intensity multiplier. Default `1`. */
  intensity?: number;
  /**
   * Half-extents `(halfWidth, halfHeight)` in world units of the rectangular
   * zone this ambient light fills, centred on the entity's `GlobalTransform`.
   *
   * When omitted the light is **global** (covers the whole view), which is
   * equivalent to raising `Light2dSettings.ambient` — prefer the setting for a
   * single scene-wide floor and reserve `AmbientLight2d` for **regional**
   * ambient where distinct areas need distinct ambient colour or strength.
   */
  halfExtents?: Vec2;
}

/**
 * ECS component contributing flat ambient light to a region of the scene.
 *
 * Two modes:
 * - **Regional** (with {@link halfExtents}): a world-space rectangle centred on
 *   the entity's `GlobalTransform`, filled with constant `color * intensity`.
 *   Overlapping zones sum additively, on top of the global
 *   `Light2dSettings.ambient` floor. This is the reason the component exists —
 *   multiple ambient areas one global setting cannot express.
 * - **Global** (without {@link halfExtents}): covers the whole view. Functionally
 *   identical to raising `Light2dSettings.ambient`; prefer the setting in that
 *   case.
 *
 * Requires `Transform`, `GlobalTransform`, `Visibility`, `InheritedVisibility`,
 * and `ViewVisibility` for parity with the other 2D light components. An
 * invisible ambient light contributes nothing.
 *
 * @example
 * ```ts
 * import { AmbientLight2d, Transform } from '@retro-engine/engine';
 * import { vec2, vec3 } from '@retro-engine/math';
 *
 * // A warm ambient pool around the campfire area.
 * cmd.spawn(
 *   new AmbientLight2d({
 *     color: vec3.create(1, 0.7, 0.4),
 *     intensity: 0.5,
 *     halfExtents: vec2.create(200, 150),
 *   }),
 *   new Transform(vec3.create(-300, 0, 0)),
 * );
 * ```
 */
export class AmbientLight2d {
  color: Vec3;
  intensity: number;
  halfExtents: Vec2 | undefined;

  constructor(options: AmbientLight2dOptions = {}) {
    this.color = options.color ?? vec3.create(1, 1, 1);
    this.intensity = options.intensity ?? 1;
    this.halfExtents = options.halfExtents;
  }

  static readonly requires = [
    Transform,
    GlobalTransform,
    Visibility,
    InheritedVisibility,
    ViewVisibility,
  ];
}
