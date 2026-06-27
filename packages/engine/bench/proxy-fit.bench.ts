// Proxy re-fit hot path (ADR-0133). When the body morphs in the character creator,
// every fitted garment is re-fitted: each proxy vertex = Σ baryᵢ·base[triᵢ] +
// scaled offset. Cost grows with proxy vertex count; on the edit interaction path
// (a body slider drag re-fits all garments), so it is worth tracking.
//
// See docs/adr/ADR-0017 (bench schema).

import { bench, summary } from 'mitata';

import { fitProxy } from '../src/proxy/proxy-fit';
import type { ProxyFitting } from '../src/proxy/proxy-fitting';

const BASE_VERTS = 19158;
const PROXY_COUNTS = [4000, 16000] as const;

const buildBase = (): Float32Array => {
  const p = new Float32Array(BASE_VERTS * 3);
  for (let i = 0; i < p.length; i++) p[i] = Math.sin(i) * 0.5;
  return p;
};

const buildFitting = (count: number): ProxyFitting => {
  const triIndices = new Uint32Array(count * 3);
  const baryWeights = new Float32Array(count * 3);
  const offsets = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    triIndices[i * 3] = (i * 7) % BASE_VERTS;
    triIndices[i * 3 + 1] = (i * 7 + 1) % BASE_VERTS;
    triIndices[i * 3 + 2] = (i * 7 + 2) % BASE_VERTS;
    baryWeights[i * 3] = 0.5;
    baryWeights[i * 3 + 1] = 0.3;
    baryWeights[i * 3 + 2] = 0.2;
    offsets[i * 3] = 0.01;
    offsets[i * 3 + 1] = 0.02;
    offsets[i * 3 + 2] = 0.01;
  }
  return {
    count,
    triIndices,
    baryWeights,
    offsets,
    scale: { x: { v1: 0, v2: 1, den: 1 }, y: { v1: 0, v2: 1, den: 1 }, z: { v1: 0, v2: 1, den: 1 } },
  };
};

summary(() => {
  for (const count of PROXY_COUNTS) {
    bench(`fitProxy @ ${count} proxy verts onto a ${BASE_VERTS}-vert body`, function* () {
      const base = buildBase();
      const fitting = buildFitting(count);
      const out = new Float32Array(count * 3);
      yield () => fitProxy(base, fitting, out);
    });
  }
});
