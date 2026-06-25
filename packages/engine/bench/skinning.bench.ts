// Joint-palette recompute hot path (ADR-0114). Every frame, after transform
// propagation, the skinning system recomputes each skinned entity's joint
// palette — `palette[i] = inverse(meshGlobal) · jointGlobal[i] · inverseBind[i]`
// — one mat4 inverse per entity plus two mat4 multiplies per joint. Cost grows
// with `entities × joints`, so it is on the per-frame chain for any animated
// scene. This bench measures the pure recompute across entity and joint counts;
// the GPU upload (one writeBuffer) is invisible to mitata and not measured here.
//
// See docs/adr/ADR-0017 (bench schema).

import { bench, summary } from 'mitata';

import { mat4, vec3 } from '@retro-engine/math';
import type { Mat4 } from '@retro-engine/math';

import { computeSkinningPalette } from '../src/skinning/palette';
import { SkinnedMeshPalette } from '../src/skinning/skeleton';

const ENTITY_COUNTS = [64, 256] as const;
const JOINT_COUNTS = [32, 128] as const;

interface SkinnedEntity {
  readonly meshGlobal: Mat4;
  readonly jointGlobals: (Mat4 | undefined)[];
  readonly inverseBinds: Mat4[];
  readonly palette: SkinnedMeshPalette;
}

const buildEntity = (jointCount: number, seed: number): SkinnedEntity => {
  const jointGlobals: Mat4[] = [];
  const inverseBinds: Mat4[] = [];
  for (let i = 0; i < jointCount; i++) {
    const t = vec3.create((i + seed) * 0.5, Math.sin(i + seed), (i % 7) * 0.25);
    const bind = mat4.translation(t);
    inverseBinds.push(mat4.inverse(bind, mat4.create()));
    // Pose differs from bind so the palette is a non-trivial transform.
    jointGlobals.push(mat4.translation(vec3.create(t[0]! + 0.1, t[1]!, t[2]!)));
  }
  return {
    meshGlobal: mat4.translation(vec3.create(seed, 0, 0)),
    jointGlobals,
    inverseBinds,
    palette: new SkinnedMeshPalette(jointCount),
  };
};

for (const jointCount of JOINT_COUNTS) {
  summary(() => {
    for (const entityCount of ENTITY_COUNTS) {
      bench(`computeSkinningPalette @ ${entityCount} entities × ${jointCount} joints`, function* () {
        const entities = Array.from({ length: entityCount }, (_unused, i) =>
          buildEntity(jointCount, i),
        );
        yield () => {
          for (const e of entities) {
            computeSkinningPalette(e.meshGlobal, e.jointGlobals, e.inverseBinds, e.palette);
          }
        };
      });
    }
  });
}
