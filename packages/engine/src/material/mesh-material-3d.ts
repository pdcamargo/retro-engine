import type { Handle } from '@retro-engine/assets';

import type { Material } from './material';

/**
 * ECS component pairing an entity to a registered material asset of type `M`
 * by `Handle<M>`. The phantom `M` parameter distinguishes
 * `MeshMaterial3d<StandardMaterial>` from `MeshMaterial3d<UnlitMaterial>` at
 * the type level; the runtime data is just the handle.
 *
 * Companion to `Mesh3d`. A `MeshMaterial3d` without a sibling `Mesh3d` is
 * silently a no-op — material draw systems iterate `(Mesh3d, MeshMaterial3d<M>)`
 * jointly.
 *
 * `MeshMaterial3d<M>` declares no `requires` — the `Mesh3d` component owns
 * the transform / visibility prerequisites; pairing is consumer responsibility.
 *
 * @example
 * ```ts
 * const handle = world.getResource(Materials<UnlitMaterial>)!.add(
 *   new UnlitMaterial({ color: vec4(0.2, 0.6, 1.0, 1.0) }),
 * );
 * app.spawn(new Mesh3d(cubeMesh), new MeshMaterial3d(handle));
 * ```
 */
export class MeshMaterial3d<M extends Material> {
  readonly handle: Handle<M>;

  constructor(handle: Handle<M>) {
    this.handle = handle;
  }
}
