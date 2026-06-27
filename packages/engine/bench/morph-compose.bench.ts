// Character-creator composition hot path (ADR-0131). Dragging a slider recomposes
// the base mesh from its active morph targets: base + Σ weightᵢ·deltaᵢ, sparse, so
// cost grows with Σ targetᵢ.count (active targets × verts each moves). On the
// edit interaction path, so worth tracking. Re-upload (one writeBuffer) and the
// normal recompute are separate and not measured here.
//
// See docs/adr/ADR-0017 (bench schema).

import { bench, summary } from 'mitata';

import { composeMorphedPositions, type WeightedMorphTarget } from '../src/morph/morph-compose';
import { SparseMorphTarget } from '../src/morph/sparse-morph-target';

const BASE_VERTS = 19158; // the MakeHuman base
const ACTIVE_COUNTS = [8, 40] as const;
const PER_TARGET = 600; // vertices each target moves

const buildBase = (): Float32Array => {
  const p = new Float32Array(BASE_VERTS * 3);
  for (let i = 0; i < p.length; i++) p[i] = Math.sin(i) * 0.5;
  return p;
};

const buildTargets = (count: number): WeightedMorphTarget[] => {
  const out: WeightedMorphTarget[] = [];
  for (let t = 0; t < count; t++) {
    const indices = new Uint32Array(PER_TARGET);
    const deltas = new Float32Array(PER_TARGET * 3);
    for (let i = 0; i < PER_TARGET; i++) {
      indices[i] = (t * 37 + i * 11) % BASE_VERTS;
      deltas[i * 3] = 0.01;
      deltas[i * 3 + 1] = -0.01;
      deltas[i * 3 + 2] = 0.005;
    }
    out.push({ target: new SparseMorphTarget(`t${t}`, indices, deltas), weight: 0.5 });
  }
  return out;
};

summary(() => {
  for (const count of ACTIVE_COUNTS) {
    bench(`composeMorphedPositions @ ${BASE_VERTS} verts × ${count} active targets`, function* () {
      const base = buildBase();
      const targets = buildTargets(count);
      const out = new Float32Array(base.length);
      yield () => composeMorphedPositions(base, targets, out);
    });
  }
});
