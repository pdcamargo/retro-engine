// Immediate-mode gizmo buffer hot path: every frame, gizmo draw calls append
// line segments and the Prepare stage packs them into the interleaved vertex
// scratch that feeds the single per-frame writeBuffer. Both costs scale with
// segment count, so they belong in the bench suite (content-scaling per-frame
// work). See docs/adr/ADR-0017 (bench schema).

import { color, vec3 } from '@retro-engine/math';
import { bench, summary } from 'mitata';

import { Gizmos } from '../src/gizmos/gizmos';

const white = color(1, 1, 1, 1);
const a = vec3.create(0, 0, 0);
const b = vec3.create(1, 1, 1);
const SEGMENT_COUNTS = [1_000, 10_000, 100_000] as const;

// Packs this frame's segments the way GizmoMesh.prepare does, minus the GPU
// upload (no device in a headless bench) — the per-frame array churn we care about.
const packToScratch = (g: Gizmos, scratch: Float32Array): void => {
  let o = 0;
  for (let i = 0; i < g.count; i++) {
    const p = i * 6;
    const c = i * 8;
    scratch[o++] = g.positions[p]!;
    scratch[o++] = g.positions[p + 1]!;
    scratch[o++] = g.positions[p + 2]!;
    scratch[o++] = g.colors[c]!;
    scratch[o++] = g.colors[c + 1]!;
    scratch[o++] = g.colors[c + 2]!;
    scratch[o++] = g.colors[c + 3]!;
    scratch[o++] = g.positions[p + 3]!;
    scratch[o++] = g.positions[p + 4]!;
    scratch[o++] = g.positions[p + 5]!;
    scratch[o++] = g.colors[c + 4]!;
    scratch[o++] = g.colors[c + 5]!;
    scratch[o++] = g.colors[c + 6]!;
    scratch[o++] = g.colors[c + 7]!;
  }
};

for (const count of SEGMENT_COUNTS) {
  summary(() => {
    bench(`gizmo line append @ ${count} segments`, function* () {
      const g = new Gizmos();
      yield () => {
        g.clear();
        for (let i = 0; i < count; i++) g.line(a, b, white);
      };
    });

    bench(`gizmo pack-to-scratch @ ${count} segments`, function* () {
      const g = new Gizmos();
      for (let i = 0; i < count; i++) g.line(a, b, white);
      const scratch = new Float32Array(count * 14);
      yield () => packToScratch(g, scratch);
    });
  });
}

summary(() => {
  bench('gizmo composite decomposition (cuboid + sphere + grid)', function* () {
    const g = new Gizmos();
    const center = vec3.create(0, 0, 0);
    const half = vec3.create(1, 1, 1);
    const up = vec3.create(0, 1, 0);
    yield () => {
      g.clear();
      for (let i = 0; i < 100; i++) {
        g.cuboid(center, half, white);
        g.sphere(center, 1, white, 24);
        g.grid(center, up, 10, 10, 1, white);
      }
    };
  });
});
