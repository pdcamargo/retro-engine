/**
 * Selects which kernel `retro_engine::shadow3d` uses to sample the shadow atlas
 * when shading a fragment under a directional or spot light. The choice is
 * global — held on {@link Shadow3dSettings.filteringMethod} — and applies to
 * every cascade and every shadowed light that frame.
 *
 * - `'Hardware2x2'` — single `textureSampleCompare` with the engine's
 *   `linear`-min/mag comparison sampler, i.e. the hardware 2×2 bilinear PCF
 *   that ships from day one. One tap per sample call; zero added cost over the
 *   pre-PCF behaviour. Edges are crisp / lightly stairstepped. The default.
 * - `'Castano13'` — Castaño 2013 9-tap weighted-bilinear PCF (the kernel Bevy
 *   ships as its Gaussian option). Nine `textureSampleCompare` calls in a 3×3
 *   pattern with binomial weights (1-2-1 / 2-4-2 / 1-2-1, sum 16). Smooth
 *   penumbras at roughly nine times the sample cost of `'Hardware2x2'`.
 * - `'Pcf5x5'` — 25-tap uniform-weight PCF in a 5×5 pattern. Widest blur of the
 *   three; roughly 25× the sample cost. Useful for stylised soft-shadow looks.
 */
export const ShadowFilteringMethod = Object.freeze({
  Hardware2x2: 'Hardware2x2',
  Castano13: 'Castano13',
  Pcf5x5: 'Pcf5x5',
} as const);

/**
 * One of the {@link ShadowFilteringMethod} string literals.
 *
 * @see ShadowFilteringMethod
 */
export type ShadowFilteringMethod =
  (typeof ShadowFilteringMethod)[keyof typeof ShadowFilteringMethod];

/**
 * Ordinal each filtering method is packed as in `GpuLights.shadow_flags.x`.
 * The WGSL `retro_engine::shadow3d` module branches on the matching
 * `SHADOW_FILTER_*` constant, so keep these two tables in sync.
 *
 * @internal
 */
export const SHADOW_FILTERING_METHOD_ORDINAL: Record<ShadowFilteringMethod, number> = {
  Hardware2x2: 0,
  Castano13: 1,
  Pcf5x5: 2,
};
