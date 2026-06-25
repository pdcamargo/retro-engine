// Clip-sampling hot path (ADR-0116, ADR-0117). Each frame the animation system
// samples every track of every active clip and writes the result into the
// targeted property. Cost grows with `tracks × active clips`, so the per-track
// sample is on the per-frame chain for any animated scene. This bench measures
// the pure sampler across track counts and interpolation modes (LINEAR vec3,
// shortest-path quaternion slerp, CUBICSPLINE vec3); the component write and the
// (player, id) → entity binding are excluded — this isolates the inner loop.
//
// See docs/adr/ADR-0017 (bench schema).

import { bench, summary } from 'mitata';

import type { Interpolation, KeyframeSampler } from '../src/animation/animation-clip';
import { sampleInto } from '../src/animation/sampler';

const TRACK_COUNTS = [128, 512] as const;
const KEYFRAMES = 8;

interface BenchTrack {
  readonly sampler: KeyframeSampler;
  readonly slerp: boolean;
  readonly out: Float32Array;
}

const makeTimes = (): Float32Array =>
  Float32Array.from({ length: KEYFRAMES }, (_unused, i) => i / (KEYFRAMES - 1));

const makeTrack = (kind: 'vec3-linear' | 'quat-linear' | 'vec3-cubic', seed: number): BenchTrack => {
  const cc = kind === 'quat-linear' ? 4 : 3;
  const interpolation: Interpolation = kind === 'vec3-cubic' ? 'CUBICSPLINE' : 'LINEAR';
  const stride = interpolation === 'CUBICSPLINE' ? cc * 3 : cc;
  const values = new Float32Array(KEYFRAMES * stride);
  for (let k = 0; k < KEYFRAMES; k++) {
    for (let c = 0; c < cc; c++) {
      values[k * stride + (interpolation === 'CUBICSPLINE' ? cc + c : c)] =
        Math.sin(seed + k * 0.3 + c);
    }
  }
  return {
    sampler: { times: makeTimes(), values, componentCount: cc, interpolation },
    slerp: kind === 'quat-linear',
    out: new Float32Array(cc),
  };
};

const buildTracks = (count: number): BenchTrack[] => {
  const kinds = ['vec3-linear', 'quat-linear', 'vec3-cubic'] as const;
  return Array.from({ length: count }, (_unused, i) => makeTrack(kinds[i % 3]!, i));
};

summary(() => {
  for (const trackCount of TRACK_COUNTS) {
    bench(`sampleInto @ ${trackCount} tracks × ${KEYFRAMES} keyframes`, function* () {
      const tracks = buildTracks(trackCount);
      // A time that lands mid-interval so every mode does real interpolation work.
      const t = 0.42;
      yield () => {
        for (const track of tracks) sampleInto(track.sampler, t, track.slerp, track.out);
      };
    });
  }
});
