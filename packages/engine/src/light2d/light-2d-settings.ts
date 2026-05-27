import type { Vec4 } from '@retro-engine/math';
import { vec4 } from '@retro-engine/math';

/**
 * Mode the composite pass uses to combine the accumulated light against the
 * base color.
 *
 * - `'multiply'` — `surface = base * light` (default; the classic 2D lighting
 *   look — fully unlit areas read as `base * ambient`, fully lit areas read
 *   as `base * lightContribution`).
 * - `'add'` — `surface = base + light` (additive overlay).
 * - `'screen'` — `surface = 1 - (1 - base) * (1 - light)` (soft-light overlay).
 *
 * The composite pipeline is specialized per mode (one fragment entry point
 * each), so switching modes selects a cached pipeline rather than branching
 * per pixel.
 */
export type Light2dCompositeMode = 'multiply' | 'add' | 'screen';

/**
 * App-level resource controlling per-frame 2D-lighting behaviour.
 *
 * - {@link ambient} is the clear value the light accumulation pass writes
 *   into the per-camera `lightAccum` texture before any `PointLight2d`
 *   contributes. Acts as the global ambient floor — multiply composite
 *   reads it as the minimum lighting any pixel sees. Default `(0, 0, 0, 1)`
 *   means "no ambient" — the screen would be black before composite if no
 *   light reaches it. Set to e.g. `(0.1, 0.1, 0.1, 1)` for a dim ambient
 *   floor so unlit regions read as "in shadow" rather than "broken."
 * - {@link compositeMode} selects how the composite pass combines the
 *   accumulated light against the base color (`'multiply'` / `'add'` /
 *   `'screen'`).
 *
 * Inserted by `Light2dPlugin` with the defaults above; gameplay /
 * scene-setup code mutates it directly to change ambient or composite mode
 * at runtime.
 */
export class Light2dSettings {
  ambient: Vec4 = vec4.create(0, 0, 0, 1);
  compositeMode: Light2dCompositeMode = 'multiply';

  constructor(options: { ambient?: Vec4; compositeMode?: Light2dCompositeMode } = {}) {
    if (options.ambient !== undefined) this.ambient = options.ambient;
    if (options.compositeMode !== undefined) this.compositeMode = options.compositeMode;
  }
}
