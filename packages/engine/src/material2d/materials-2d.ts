import type { MaterialAssetEvent, MaterialHandle } from '../material/materials';
import { Materials } from '../material/materials';

import type { Material2d } from './material-2d';

/**
 * App-level registry mapping {@link MaterialHandle}s to Material2d instances
 * of type `M`. Inserted as a main-world resource by `Material2dPlugin<M>`.
 *
 * Type alias of {@link Materials} — the registry shape is identical to the 3D
 * registry. The 2D / 3D distinction is at the {@link Material2d} trait level
 * (which extends `Material`) and at the plugin level (which determines which
 * sub-graph the queue routes phase items into).
 *
 * The plugin synthesises a distinct subclass at construction time so the
 * ECS's class-keyed resource store disambiguates `Materials2d<ColorMaterial2d>`
 * from any other registry instance. The runtime class identity is the
 * subclass; this alias just narrows the generic parameter.
 *
 * @example
 * ```ts
 * const plugin = new Material2dPlugin(ColorMaterial2d);
 * const reg = app.getResource(plugin.Materials2d)!;
 * const handle = reg.add(new ColorMaterial2d({ color: vec4.create(1, 0, 0, 1) }));
 * ```
 */
export type Materials2d<M extends Material2d> = Materials<M>;

export type { MaterialAssetEvent, MaterialHandle };
