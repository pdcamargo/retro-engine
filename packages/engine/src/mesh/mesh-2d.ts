import type { Handle } from '@retro-engine/assets';

import { GlobalTransform, Transform } from '../transform';
import { InheritedVisibility, ViewVisibility, Visibility } from '../visibility';

import type { Mesh } from './mesh';

/**
 * ECS component pairing an entity to a registered {@link Mesh} asset by
 * handle, drawn as a 2D mesh through the Core2d sub-graph.
 * Spawning a `Mesh2d` makes the entity drawable; pair with a
 * `MeshMaterial2d<M>` to select the material that supplies its shader and
 * bind-group data.
 *
 * Shape-identical to `Mesh3d` — same handle wrapper, same required components.
 * The 2D / 3D distinction is in the consumer-side pairing (a `Mesh2d` is
 * picked up by `Material2dPlugin<M>`'s queue, a `Mesh3d` by `MaterialPlugin<M>`'s
 * queue) and in the camera's sub-graph (`Camera2d` → Core2d → no depth
 * attachment → painter's-algorithm sort).
 *
 * Requires `Transform`, `GlobalTransform`, `Visibility`, `InheritedVisibility`,
 * and `ViewVisibility` — spawning with `new Mesh2d(h)` alone auto-attaches the
 * rest via the engine's required-component resolution.
 *
 * The held `Handle<Mesh>` is opaque; reach the underlying `Mesh` via
 * `world.getResource(Meshes)?.get(handle)`.
 *
 * @example
 * ```ts
 * const rect = world.getResource(Meshes)!.add(
 *   new Rectangle({ width: 64, height: 32 }).mesh().build(),
 * );
 * const red = world.getResource(plugin.Materials2d)!.add(
 *   new ColorMaterial2d({ color: vec4.create(1, 0.2, 0.2, 1) }),
 * );
 * app.spawn(new Mesh2d(rect), new plugin.MeshMaterial2d(red));
 * ```
 */
export class Mesh2d {
  readonly handle: Handle<Mesh>;

  constructor(handle: Handle<Mesh>) {
    this.handle = handle;
  }

  static readonly requires = [
    Transform,
    GlobalTransform,
    Visibility,
    InheritedVisibility,
    ViewVisibility,
  ];
}
