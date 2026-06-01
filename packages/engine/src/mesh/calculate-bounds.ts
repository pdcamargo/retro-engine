import type { Handle } from '@retro-engine/assets';
import { Aabb } from '@retro-engine/math';
import type { Entity, Query as QueryHandle, World } from '@retro-engine/ecs';

import { NoFrustumCulling } from '../visibility/visibility';

import { Mesh3d } from './mesh-3d';
import type { Mesh } from './mesh';

interface PendingAabbInsert {
  entity: Entity;
  aabb: Aabb;
}

/**
 * Auto-AABB writer for `Mesh3d` entities.
 *
 * Registered by `MeshPlugin` at the head of `'postUpdate'` — the slot reserved
 * by `VisibilityPlugin`'s documented order
 * (`CalculateBounds → UpdateFrusta → VisibilityPropagate → CheckVisibility`).
 *
 * Body: iterate the `Mesh3d` entities the query yields (those without
 * {@link NoFrustumCulling}), look up the underlying `Mesh` via the main-world
 * `Meshes` registry, compute its local-space AABB, and insert / overwrite the
 * entity's `Aabb` component. Entities carrying `NoFrustumCulling` are skipped —
 * that marker is the documented "I manage bounds myself" escape hatch, and
 * `checkVisibilitySystem` also short-circuits the frustum test for them.
 *
 * The query is change-gated on `Mesh3d`. A `Mesh.computeAabb()` walk is
 * O(vertices), and a mesh's local-space bounds only move when its geometry
 * does — re-deriving them every frame is wasted work that scales with scene
 * size. An entity is therefore visited on the frame its `Mesh3d` is added and
 * again only when `Mesh3d` is flagged changed.
 *
 * One consequence: editing a `Mesh`'s vertex data in place while keeping the
 * same handle does not refresh bounds on its own, because the gate keys on the
 * `Mesh3d` component, not on the `Mesh` asset. Signal such an edit by
 * re-inserting `Mesh3d` on each affected entity (or `world.markChanged(entity,
 * Mesh3d)`).
 *
 * @param meshes Main-world {@link Meshes} resource — the asset registry.
 * @param meshables Query handle over rows `(Mesh3d,)`, without
 *   {@link NoFrustumCulling}, gated on changed `Mesh3d`.
 * @param world The main world, used to insert / overwrite `Aabb` on the
 *   matched entities.
 */
export const calculateBoundsSystem = (
  meshes: { get(handle: Handle<Mesh>): Mesh | undefined },
  meshables: QueryHandle<
    readonly [typeof Mesh3d],
    { without: readonly (typeof NoFrustumCulling)[]; changed: readonly (typeof Mesh3d)[] }
  >,
  world: World,
): void => {
  // Collect first, mutate after. `world.insertBundle(entity, [aabb])` is a
  // structural mutation — when the entity doesn't already carry an `Aabb`,
  // the call moves it to a new archetype, swap-removing the row from the
  // archetype the query is currently iterating. The query docs (Query class
  // TSDoc, packages/ecs/src/query.ts) call this out: "structural mutations
  // during iteration are undefined behavior — defer them." In practice the
  // column was returning `undefined` on subsequent rows, crashing on the
  // `mesh3d.handle` read.
  const pending: PendingAabbInsert[] = [];
  for (const row of meshables.entries()) {
    const entity = row[0] as Entity;
    const mesh3d = row[1] as Mesh3d;
    if (mesh3d === undefined) continue;
    const mesh = meshes.get(mesh3d.handle);
    if (mesh === undefined) continue;
    pending.push({ entity, aabb: mesh.computeAabb() });
  }
  for (const { entity, aabb } of pending) {
    world.insertBundle(entity, [aabb]);
  }
};

// Sentinel re-export so consumers can `import { Aabb } from '@retro-engine/engine'`
// without dipping into `@retro-engine/math`. Kept here to avoid duplicating
// the auto-bounds story in the engine's root index.ts.
export { Aabb };
