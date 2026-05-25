import { Aabb } from '@retro-engine/math';
import type { Entity, Query as QueryHandle, World } from '@retro-engine/ecs';

import { NoFrustumCulling } from '../visibility/visibility';

import { Mesh3d } from './mesh-3d';
import type { Mesh } from './mesh';
import type { MeshHandle } from './meshes';

/**
 * Auto-AABB writer for `Mesh3d` entities.
 *
 * Registered by `MeshPlugin` at the head of `'postUpdate'` — the slot reserved
 * by `VisibilityPlugin`'s documented order
 * (`CalculateBounds → UpdateFrusta → VisibilityPropagate → CheckVisibility`).
 *
 * Body: iterate every `Mesh3d` entity without {@link NoFrustumCulling}, look
 * up the underlying `Mesh` via the main-world `Meshes` registry, compute its
 * local-space AABB, and insert / overwrite the entity's `Aabb` component.
 * Entities carrying `NoFrustumCulling` are skipped — that marker is the
 * documented "I manage bounds myself" escape hatch, and `checkVisibilitySystem`
 * also short-circuits the frustum test for them.
 *
 * Re-runs every frame for now. A `Mesh.computeAabb()` walk is O(vertices);
 * with a few hundred mesh entities this is sub-millisecond. An
 * `Added<Mesh3d> | Changed<Mesh3d>`-gated form is a follow-up optimization
 * once a profile shows it's worth the change-detection plumbing.
 *
 * @param meshes Main-world {@link Meshes} resource — the asset registry.
 * @param meshables Query handle over rows `(Mesh3d,)` without
 *   {@link NoFrustumCulling}.
 * @param world The main world, used to insert / overwrite `Aabb` on the
 *   matched entities.
 */
export const calculateBoundsSystem = (
  meshes: { get(handle: MeshHandle): Mesh | undefined },
  meshables: QueryHandle<readonly [typeof Mesh3d], { without: readonly (typeof NoFrustumCulling)[] }>,
  world: World,
): void => {
  for (const row of meshables.entries()) {
    const entity = row[0] as Entity;
    const mesh3d = row[1] as Mesh3d;
    const mesh = meshes.get(mesh3d.handle);
    if (mesh === undefined) continue;
    const aabb = mesh.computeAabb();
    world.insertBundle(entity, [aabb]);
  }
};

// Sentinel re-export so consumers can `import { Aabb } from '@retro-engine/engine'`
// without dipping into `@retro-engine/math`. Kept here to avoid duplicating
// the auto-bounds story in the engine's root index.ts.
export { Aabb };
