import { GlobalTransform, Transform } from '../transform';
import { InheritedVisibility, ViewVisibility, Visibility } from '../visibility';

import type { MeshHandle } from './meshes';

/**
 * ECS component pairing an entity to a registered {@link Mesh} asset by
 * {@link MeshHandle}. Spawning a `Mesh3d` makes the entity drawable as a 3D
 * mesh; pair with a `MeshMaterial3d<M>` to select the material.
 *
 * `Mesh3d` requires `Transform`, `GlobalTransform`, `Visibility`,
 * `InheritedVisibility`, and `ViewVisibility` — spawning with `new Mesh3d(h)`
 * alone auto-attaches the rest via the engine's required-component
 * resolution.
 *
 * The held `MeshHandle` is opaque; reach the underlying `Mesh` via
 * `world.getResource(Meshes)?.get(handle)`.
 *
 * @example
 * ```ts
 * const cube = world.getResource(Meshes)!.add(new Cuboid(1, 1, 1).mesh().build());
 * const red = world.getResource(Materials<StandardMaterial>)!.add(
 *   new StandardMaterial({ baseColor: vec4(1, 0.2, 0.2, 1) }),
 * );
 * app.spawn(new Mesh3d(cube), new MeshMaterial3d(red));
 * ```
 */
export class Mesh3d {
  readonly handle: MeshHandle;

  constructor(handle: MeshHandle) {
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
