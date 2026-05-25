import type { MaterialHandle } from '../material/materials';

import type { Material2d } from './material-2d';

/**
 * ECS component pairing an entity to a registered Material2d asset of type
 * `M` by {@link MaterialHandle}. The phantom `M` parameter distinguishes
 * `MeshMaterial2d<ColorMaterial2d>` from any other material binding at the
 * type level; the runtime data is just the handle.
 *
 * Companion to `Mesh2d`. A `MeshMaterial2d` without a sibling `Mesh2d` is
 * silently a no-op — Material2d draw systems iterate
 * `(Mesh2d, MeshMaterial2d<M>)` jointly.
 *
 * `MeshMaterial2d<M>` declares no `requires` — the `Mesh2d` component owns
 * the transform / visibility prerequisites; pairing is consumer responsibility.
 *
 * @example
 * ```ts
 * const plugin = new Material2dPlugin(ColorMaterial2d);
 * const handle = world.getResource(plugin.Materials2d)!.add(
 *   new ColorMaterial2d({ color: vec4.create(0.2, 0.6, 1.0, 1.0) }),
 * );
 * app.spawn(new Mesh2d(rectMesh), new plugin.MeshMaterial2d(handle));
 * ```
 */
export class MeshMaterial2d<M extends Material2d> {
  readonly handle: MaterialHandle<M>;

  constructor(handle: MaterialHandle<M>) {
    this.handle = handle;
  }
}
