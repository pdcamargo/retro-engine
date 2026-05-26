import type { Vec3 } from '@retro-engine/math';
import { vec3 } from '@retro-engine/math';

import { Transform, GlobalTransform } from '../transform';
import { InheritedVisibility, ViewVisibility, Visibility } from '../visibility';

/**
 * Options accepted by the {@link PointLight2d} constructor. Every field is
 * optional; omitted fields take the documented default.
 */
export interface PointLight2dOptions {
  /** RGB tint of the light's emission. Linear-space colour. Default `(1, 1, 1)`. */
  color?: Vec3;
  /**
   * Unitless intensity multiplier. The fragment shader emits
   * `color * intensity * falloff`. Higher values produce brighter centres;
   * tuning the value is the consumer's responsibility — no physical units are
   * assumed (no Lumens, no Watts). Default `1`.
   */
  intensity?: number;
  /**
   * Outer world-space radius beyond which the contribution falls to zero.
   * Drives the size of the accumulation quad (side `2 * range`) and the
   * far edge of the `smoothstep` falloff. Must be `> 0`; default `100`.
   */
  range?: number;
  /**
   * Inner world-space radius within which the light is at full brightness.
   * The inner edge of the `smoothstep` falloff. Default `0` (single-point
   * falloff from the centre).
   */
  radius?: number;
}

/**
 * ECS component placing a 2D point light at the entity's `GlobalTransform`.
 *
 * The light's radial contribution is rendered into the camera's
 * `lightAccum` texture by the Phase 9 accumulation pass: each visible
 * `PointLight2d` becomes one additive instanced quad of side `2 * range`
 * centred on the entity's world position. Inside `radius` the light is at
 * full brightness; between `radius` and `range` the contribution ramps to
 * zero via `1 - smoothstep(radius, range, distance)`.
 *
 * `PointLight2d` requires `Transform`, `GlobalTransform`, `Visibility`,
 * `InheritedVisibility`, and `ViewVisibility` — spawning a `PointLight2d`
 * alone auto-attaches the rest via the engine's required-component
 * resolution. The visibility chain participates in render-layer and frustum
 * culling exactly like sprites; an invisible light contributes nothing to
 * accumulation.
 *
 * Lighting is opt-in: the camera's render pipeline only reads
 * `PointLight2d` entities when a `Light2dPlugin` is registered on the App.
 *
 * @example
 * ```ts
 * import { PointLight2d, Transform } from '@retro-engine/engine';
 * import { vec3 } from '@retro-engine/math';
 *
 * cmd.spawn(
 *   new PointLight2d({
 *     color: vec3.create(1, 0.9, 0.6),
 *     intensity: 2,
 *     range: 200,
 *     radius: 24,
 *   }),
 *   new Transform(vec3.create(0, 0, 0)),
 * );
 * ```
 */
export class PointLight2d {
  color: Vec3;
  intensity: number;
  range: number;
  radius: number;

  constructor(options: PointLight2dOptions = {}) {
    this.color = options.color ?? vec3.create(1, 1, 1);
    this.intensity = options.intensity ?? 1;
    this.range = options.range ?? 100;
    this.radius = options.radius ?? 0;
  }

  static readonly requires = [
    Transform,
    GlobalTransform,
    Visibility,
    InheritedVisibility,
    ViewVisibility,
  ];
}
