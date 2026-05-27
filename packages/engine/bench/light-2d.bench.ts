// Light2dPlugin prepare/queue hot path (Renderer Phase 9 / ADR-0037, ADR-0041):
//
// - The lighting queue system visits every visible 2D light, packs each one
//   into the per-frame `Light2dInstanceBuffer` (13 f32 per light) and emits
//   one batch per Core2d camera pointing at the packed range.
// - This bench measures the pack-loop cost at 100 / 1 000 / 5 000 lights for
//   point and spot kinds (spot does the extra cone trig). The fixture bypasses
//   the App / ECS harness: synthetic light instances + matrices feed the pack
//   functions directly so the measurement isolates the per-light arithmetic
//   from query iteration and asset upload.
//
// Composite pass cost is GPU-fragment dominated and not measurable from a
// headless bench; see docs/backlog/integrated-frame-benches.md for the
// per-system cost-attribution plan.
//
// See docs/adr/ADR-0017 (bench schema) and docs/adr/ADR-0037 / ADR-0041
// (2D light kinds + accumulation/composite passes).

import { bench, do_not_optimize, group, summary } from 'mitata';

import { mat4, vec2, vec3 } from '@retro-engine/math';

import {
  LIGHT2D_INSTANCE_BYTE_SIZE,
  packLightInstance,
  packSpotLightInstance,
} from '../src/light2d/light-2d-batch';
import { PointLight2d } from '../src/light2d/point-light-2d';
import { SpotLight2d } from '../src/light2d/spot-light-2d';

const COUNTS = [100, 1_000, 5_000] as const;

// Deterministic PRNG so successive bench runs see identical light layouts.
const mulberry32 = (seed: number): (() => number) => {
  let t = seed;
  return () => {
    t = (t + 0x6d2b79f5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
};

const buildFixture = (count: number) => {
  const rng = mulberry32(0xb1c11);
  const lights: { light: PointLight2d; matrix: Float32Array }[] = [];
  for (let i = 0; i < count; i++) {
    const light = new PointLight2d({
      color: vec3.create(rng(), rng(), rng()),
      intensity: 0.5 + rng() * 2,
      range: 50 + rng() * 200,
      radius: rng() * 20,
    });
    const m = mat4.identity();
    m[12] = (rng() - 0.5) * 4000;
    m[13] = (rng() - 0.5) * 4000;
    lights.push({ light, matrix: m as unknown as Float32Array });
  }
  const buffer = new ArrayBuffer(count * LIGHT2D_INSTANCE_BYTE_SIZE);
  const scratchF32 = new Float32Array(buffer);
  return { lights, scratchF32 };
};

const buildSpotFixture = (count: number) => {
  const rng = mulberry32(0x5907);
  const lights: { light: SpotLight2d; matrix: Float32Array }[] = [];
  for (let i = 0; i < count; i++) {
    const light = new SpotLight2d({
      color: vec3.create(rng(), rng(), rng()),
      intensity: 0.5 + rng() * 2,
      range: 50 + rng() * 200,
      radius: rng() * 20,
      direction: vec2.create(rng() - 0.5, rng() - 0.5),
      innerAngle: rng() * 0.4,
      outerAngle: 0.4 + rng() * 0.4,
    });
    const m = mat4.identity();
    m[12] = (rng() - 0.5) * 4000;
    m[13] = (rng() - 0.5) * 4000;
    lights.push({ light, matrix: m as unknown as Float32Array });
  }
  const buffer = new ArrayBuffer(count * LIGHT2D_INSTANCE_BYTE_SIZE);
  const scratchF32 = new Float32Array(buffer);
  return { lights, scratchF32 };
};

summary(() => {
  group('Light2dPlugin: pack visible point lights into instance scratch', () => {
    for (const count of COUNTS) {
      const { lights, scratchF32 } = buildFixture(count);
      bench(`packLightInstance × ${count}`, () => {
        let cursor = 0;
        for (const { light, matrix } of lights) {
          cursor += packLightInstance(light, matrix, scratchF32, cursor);
        }
        do_not_optimize(cursor);
      });
    }
  });

  group('Light2dPlugin: pack visible spot lights into instance scratch', () => {
    for (const count of COUNTS) {
      const { lights, scratchF32 } = buildSpotFixture(count);
      bench(`packSpotLightInstance × ${count}`, () => {
        let cursor = 0;
        for (const { light, matrix } of lights) {
          cursor += packSpotLightInstance(light, matrix, scratchF32, cursor);
        }
        do_not_optimize(cursor);
      });
    }
  });
});
