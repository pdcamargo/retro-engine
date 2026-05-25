import { RenderMaterials } from '../material/render-materials';

import type { Material2d } from './material-2d';

/**
 * Render-world mirror of {@link Materials2d} for one Material2d type `M`.
 * Populated by `Material2dPlugin<M>`'s prepare system.
 *
 * Type alias of {@link RenderMaterials} — the entry shape is identical to the
 * 3D mirror. The plugin synthesises a distinct subclass at construction time
 * so the resource store can disambiguate per-material registries.
 */
export type RenderMaterials2d<M extends Material2d> = RenderMaterials<M>;
