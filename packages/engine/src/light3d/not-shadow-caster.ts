/**
 * Marker component opting an entity's mesh out of shadow casting.
 *
 * By default every visible {@link Mesh3d} casts shadows (the shadow pass
 * re-renders its depth from each shadow-casting light's point of view). Add
 * `NotShadowCaster` to an entity to exclude it — it still renders and still
 * *receives* shadows, it just does not occlude light.
 *
 * @example
 * ```ts
 * import { Mesh3d, NotShadowCaster } from '@retro-engine/engine';
 *
 * // A glass pane or a glow sprite that should not cast a hard shadow.
 * cmd.spawn(new Mesh3d(paneMesh), material, transform, new NotShadowCaster());
 * ```
 */
export class NotShadowCaster {}
