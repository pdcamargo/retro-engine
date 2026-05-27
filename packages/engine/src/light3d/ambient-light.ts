import type { Vec3 } from '@retro-engine/math';
import { vec3 } from '@retro-engine/math';

/**
 * Options accepted by the {@link AmbientLight} constructor. Every field is
 * optional; omitted fields take the documented default.
 */
export interface AmbientLightOptions {
  /** RGB tint of the ambient term. Linear-space colour. Default `(1, 1, 1)`. */
  color?: Vec3;
  /**
   * Unitless multiplier on {@link color}, controlling how much flat fill light
   * every surface receives. Default `0.05` — a dim floor, enough to keep
   * unlit-facing surfaces from going pure black.
   */
  brightness?: number;
}

/**
 * Scene-wide ambient light, modelling the constant indirect bounce that a real
 * environment provides. A **resource**, not a component — there is one ambient
 * floor per App. Lit materials add `color * brightness` to every fragment,
 * modulated by the surface's occlusion.
 *
 * `Light3dPlugin` inserts a dim default; raise {@link brightness} (or recolour)
 * to taste, or set it near zero for a high-contrast look driven entirely by the
 * analytic lights.
 *
 * This is the placeholder that image-based lighting (Phase 10.7) eventually
 * replaces with a real prefiltered environment map.
 *
 * @example
 * ```ts
 * import { AmbientLight } from '@retro-engine/engine';
 * import { vec3 } from '@retro-engine/math';
 *
 * app.insertResource(new AmbientLight({ color: vec3.create(0.6, 0.7, 1), brightness: 0.1 }));
 * ```
 */
export class AmbientLight {
  color: Vec3;
  brightness: number;

  constructor(options: AmbientLightOptions = {}) {
    this.color = options.color ?? vec3.create(1, 1, 1);
    this.brightness = options.brightness ?? 0.05;
  }
}
