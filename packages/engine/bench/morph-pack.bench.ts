// Morph-delta packing hot path (ADR-0129). When a morphing mesh first uploads,
// its blend-shape targets are packed into the std430 storage-buffer layout the
// vertex shader reads — target-major, each record a padded position + normal
// delta. Cost grows with `targetCount × vertexCount`, the §11 "grows with
// content" trigger; a face with many expression targets makes this non-trivial.
// One-shot per mesh load (not per frame), but on the asset-load path, so it is
// worth tracking. The GPU upload (one writeBuffer) is invisible to mitata.
//
// See docs/adr/ADR-0017 (bench schema).

import { bench, summary } from 'mitata';

import { MorphTargets } from '../src/morph/morph-targets';
import type { MorphTarget } from '../src/morph/morph-targets';
import { packMorphDeltas } from '../src/morph/morph-pack';

const VERTEX_COUNTS = [2048, 8192] as const;
const TARGET_COUNTS = [8, 52] as const;

const buildMorph = (vertexCount: number, targetCount: number): MorphTargets => {
  const targets: MorphTarget[] = [];
  for (let t = 0; t < targetCount; t++) {
    const positionDeltas = new Float32Array(vertexCount * 3);
    const normalDeltas = new Float32Array(vertexCount * 3);
    for (let i = 0; i < positionDeltas.length; i++) {
      positionDeltas[i] = Math.sin(i + t) * 0.01;
      normalDeltas[i] = Math.cos(i + t) * 0.01;
    }
    targets.push({ name: `target${t}`, positionDeltas, normalDeltas });
  }
  return new MorphTargets(targets, vertexCount, undefined);
};

for (const targetCount of TARGET_COUNTS) {
  summary(() => {
    for (const vertexCount of VERTEX_COUNTS) {
      bench(`packMorphDeltas @ ${vertexCount} verts × ${targetCount} targets`, function* () {
        const morph = buildMorph(vertexCount, targetCount);
        yield () => packMorphDeltas(morph);
      });
    }
  });
}
