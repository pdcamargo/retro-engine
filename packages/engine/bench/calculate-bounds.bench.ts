// Auto-AABB writer hot path: per frame `calculateBoundsSystem` derives a
// local-space Aabb for each Mesh3d entity by walking its mesh position buffer
// (O(vertices) via `Mesh.computeAabb`). Before change-gating this ran for every
// entity every frame; the gate collapses steady-state cost to the dirty set.
//
// This bench contrasts the ungated full sweep (every entity, every frame)
// against the change-gated path at 0% and 10% dirty, across entity counts and
// a fixed mesh vertex count. The 0%-dirty case is the steady state the gate is
// meant to win — a profile showed `Aabb.fromPoints` dominating the frame when
// this ran ungated over a stress scene.
//
// See docs/adr/ADR-0017 (bench schema).

import { bench, summary } from 'mitata';

import { type Entity, World } from '@retro-engine/ecs';

import { calculateBoundsSystem } from '../src/mesh/calculate-bounds';
import { Mesh } from '../src/mesh/mesh';
import { Mesh3d } from '../src/mesh/mesh-3d';
import type { MeshHandle } from '../src/mesh/meshes';
import { MeshAttribute } from '../src/mesh/vertex-attribute';
import { NoFrustumCulling } from '../src/visibility/visibility';

const VERTEX_COUNT = 512;
const ENTITY_COUNTS = [256, 1_024, 4_096] as const;

// Single shared mesh behind every entity — the bench isolates the per-entity
// `computeAabb` walk and the query/insert cost, not asset-registry lookup.
const sharedMesh = (() => {
  const data = new Float32Array(VERTEX_COUNT * 3);
  for (let i = 0; i < data.length; i += 1) data[i] = Math.sin(i) * 10;
  return new Mesh().insertAttribute(MeshAttribute.POSITION, data);
})();

const meshesStub = { get: (): Mesh => sharedMesh };
const HANDLE = 1 as unknown as MeshHandle;

interface Scene {
  readonly world: World;
  readonly entities: readonly Entity[];
}

const buildScene = (entityCount: number): Scene => {
  const world = new World();
  const entities: Entity[] = [];
  for (let i = 0; i < entityCount; i += 1) {
    entities.push(world.spawn(new Mesh3d(HANDLE)));
  }
  return { world, entities };
};

const markDirty = (scene: Scene, pct: number): void => {
  const target = Math.floor(scene.entities.length * (pct / 100));
  for (let i = 0; i < target; i += 1) {
    scene.world.markChanged(scene.entities[i]!, Mesh3d);
  }
};

for (const entityCount of ENTITY_COUNTS) {
  summary(() => {
    // Ungated full sweep: a `sinceTick` of 0 matches every row, reproducing the
    // pre-gate "recompute all, every frame" behaviour.
    bench(`calculateBounds (full) @ ${entityCount} entities`, function* () {
      const scene = buildScene(entityCount);
      const q = scene.world.query(
        [Mesh3d],
        { without: [NoFrustumCulling], changed: [Mesh3d] },
        0,
      );
      yield () => calculateBoundsSystem(meshesStub, q, scene.world);
    });

    bench(`calculateBounds (gated) @ ${entityCount} entities @ 0% dirty`, function* () {
      const scene = buildScene(entityCount);
      // Drain the spawn-frame dirtiness so the gated path sees an idle frame.
      const warm = scene.world.query(
        [Mesh3d],
        { without: [NoFrustumCulling], changed: [Mesh3d] },
        0,
      );
      calculateBoundsSystem(meshesStub, warm, scene.world);
      const snapshot = scene.world.changeTick;
      const q = scene.world.query(
        [Mesh3d],
        { without: [NoFrustumCulling], changed: [Mesh3d] },
        snapshot,
      );
      yield () => calculateBoundsSystem(meshesStub, q, scene.world);
    });

    bench(`calculateBounds (gated) @ ${entityCount} entities @ 10% dirty`, function* () {
      const scene = buildScene(entityCount);
      const warm = scene.world.query(
        [Mesh3d],
        { without: [NoFrustumCulling], changed: [Mesh3d] },
        0,
      );
      calculateBoundsSystem(meshesStub, warm, scene.world);
      const snapshot = scene.world.changeTick;
      markDirty(scene, 10);
      const q = scene.world.query(
        [Mesh3d],
        { without: [NoFrustumCulling], changed: [Mesh3d] },
        snapshot,
      );
      yield () => calculateBoundsSystem(meshesStub, q, scene.world);
    });
  });
}
