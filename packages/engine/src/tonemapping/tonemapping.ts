/**
 * Available tonemap operators. String-literal union so the type system
 * exhaustively checks consumers; the `TONEMAPPING_METHODS` frozen list at
 * the bottom of this file is the runtime-iterable counterpart.
 *
 * - `'none'` — passthrough. Useful for debugging an HDR camera (you see
 *   exactly what the geometry/composite passes write, clipped by the LDR
 *   storage on the way out).
 * - `'reinhard'` — `c / (1 + c)`, per-channel. Simple, cheap; can desaturate
 *   highlights.
 * - `'reinhard_luminance'` — Reinhard applied to luminance with chrominance
 *   ratio preserved, so saturated highlights don't desaturate.
 * - `'aces_fitted'` — Stephen Hill's polynomial fit of the ACES RRT+ODT.
 *   Industry-standard "filmic ACES" look. Saturated, contrasty.
 * - `'agx'` — Polynomial approximation of Troy Sobotka's AgX (no LUT;
 *   contrast curve is a polynomial fit). Forgiving on intense sources;
 *   neutral midtones.
 * - `'blender_filmic'` — Polynomial approximation of Blender's filmic
 *   display transform. Soft shoulder, gentle highlight rolloff.
 * - `'somewhat_boring_display_transform'` — Tomasz Stachowiak's
 *   "somewhat-boring" curve. Predictable mid-saturation desaturation;
 *   cheaper than ACES, less aggressive than Reinhard.
 *
 * `'tony_mc_mapface'` is **not** in this union — it requires a 48³
 * `rgba16float` LUT shipped as a texture asset, which is gated on
 * `docs/roadmap/asset-system.md`. Tracked in
 * `docs/backlog/tonemapping-tony-mcmapface.md`.
 */
export type TonemappingMethod =
  | 'none'
  | 'reinhard'
  | 'reinhard_luminance'
  | 'aces_fitted'
  | 'agx'
  | 'blender_filmic'
  | 'somewhat_boring_display_transform';

/**
 * Runtime-iterable list of every `TonemappingMethod`. Mirrors the
 * `TonemappingMethod` union; both must move together. The
 * `tonemapping.test.ts` suite asserts the two are kept in sync.
 */
export const TONEMAPPING_METHODS: readonly TonemappingMethod[] = Object.freeze([
  'none',
  'reinhard',
  'reinhard_luminance',
  'aces_fitted',
  'agx',
  'blender_filmic',
  'somewhat_boring_display_transform',
] as const);

/**
 * Default tonemap operator the camera bundle factories
 * (`Camera2d({ hdr: true })` / `Camera3d({ hdr: true })`) insert when no
 * override is passed. `agx` chosen because (a) it matches Bevy's current
 * default, (b) it does not require a LUT, (c) its curve is forgiving on
 * intense sources and renders a neutral midtone without surprising
 * the user.
 */
export const DEFAULT_TONEMAPPING_METHOD: TonemappingMethod = 'agx';

/**
 * Per-camera component opting that camera into a display transform on the
 * way to its final color target. Honored only when the camera also has
 * `hdr: true`; on a non-HDR camera the tonemap node skips silently
 * because there is no HDR intermediate to read from.
 *
 * Spawn alongside a `Camera3d({ hdr: true })` / `Camera2d({ hdr: true })`
 * bundle (the factory inserts one with `DEFAULT_TONEMAPPING_METHOD` by
 * default; pass `tonemapping: 'reinhard'` to the factory or spawn this
 * component explicitly to override).
 *
 * Per-camera (not a global resource) so a multi-camera scene can mix
 * operators — e.g. a debug HUD camera on `'none'` while the main camera
 * uses `'agx'`.
 *
 * @example
 * ```ts
 * import { Camera3d, Tonemapping } from '@retro-engine/engine';
 * cmd.spawn(...Camera3d({ hdr: true, tonemapping: 'aces_fitted' }));
 * // Or, equivalently, opting into HDR without a default operator:
 * cmd.spawn(...Camera3d({ hdr: true }), new Tonemapping({ method: 'reinhard' }));
 * ```
 */
export class Tonemapping {
  method: TonemappingMethod;

  constructor(options: { method?: TonemappingMethod } = {}) {
    this.method = options.method ?? DEFAULT_TONEMAPPING_METHOD;
  }
}
