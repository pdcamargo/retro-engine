// Light3dPlugin prepare hot path (Renderer Phase 10 / ADR-0044):
//
// - The light3d-prepare system visits every visible 3D light and packs each
//   into the per-frame GpuLights uniform via packDirectionalLight /
//   packPointLight / packSpotLight (point + spot also do inverse-square +,
//   for spot, cone-cosine trig; all read the entity forward from the matrix).
// - This bench measures the pack-loop cost at 64 / 256 / 1000 lights per kind.
//   The fixture bypasses the App / ECS harness: synthetic light instances +
//   matrices feed the pack functions directly so the measurement isolates the
//   per-light arithmetic from query iteration and buffer upload.
//
// The per-fragment BRDF loop is GPU-dominated and not measurable from a
// headless bench; it is browser-verified in apps/playground (?mode=lit).
//
// See docs/adr/ADR-0017 (bench schema) and docs/adr/ADR-0044 (3D analytic
// lights + simple-forward shading).

import { bench, do_not_optimize, group, summary } from 'mitata';

import { mat4, vec3 } from '@retro-engine/math';

import {
  packDirectionalLight,
  packPointLight,
  packSpotLight,
} from '../src/light3d/gpu-lights';
import { DirectionalLight3d } from '../src/light3d/directional-light-3d';
import { PointLight3d } from '../src/light3d/point-light-3d';
import { SpotLight3d } from '../src/light3d/spot-light-3d';

const COUNTS = [64, 256, 1000] as const;

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

const randomMatrix = (rng: () => number): Float32Array => {
  const m = mat4.identity();
  m[12] = (rng() - 0.5) * 200;
  m[13] = (rng() - 0.5) * 200;
  m[14] = (rng() - 0.5) * 200;
  return m as unknown as Float32Array;
};

// Scratch large enough to pack `count` lights at any kind's stride.
const scratchFor = (count: number): Float32Array => new Float32Array(count * 16 + 1024);

const buildDirectional = (count: number) => {
  const rng = mulberry32(0xd1c);
  const lights = Array.from({ length: count }, () => ({
    light: new DirectionalLight3d({ color: vec3.create(rng(), rng(), rng()), intensity: 0.5 + rng() * 3 }),
    matrix: randomMatrix(rng),
  }));
  return { lights, f32: scratchFor(count) };
};

const buildPoint = (count: number) => {
  const rng = mulberry32(0x901);
  const lights = Array.from({ length: count }, () => ({
    light: new PointLight3d({
      color: vec3.create(rng(), rng(), rng()),
      intensity: 0.5 + rng() * 8,
      range: 5 + rng() * 40,
      radius: rng() * 2,
    }),
    matrix: randomMatrix(rng),
  }));
  return { lights, f32: scratchFor(count) };
};

const buildSpot = (count: number) => {
  const rng = mulberry32(0x5907);
  const lights = Array.from({ length: count }, () => ({
    light: new SpotLight3d({
      color: vec3.create(rng(), rng(), rng()),
      intensity: 0.5 + rng() * 8,
      range: 5 + rng() * 40,
      radius: rng() * 2,
      innerAngle: rng() * 0.4,
      outerAngle: 0.4 + rng() * 0.4,
    }),
    matrix: randomMatrix(rng),
  }));
  return { lights, f32: scratchFor(count) };
};

summary(() => {
  group('Light3dPlugin: pack directional lights', () => {
    for (const count of COUNTS) {
      const { lights, f32 } = buildDirectional(count);
      bench(`packDirectionalLight × ${count}`, () => {
        for (let i = 0; i < lights.length; i++) packDirectionalLight(lights[i]!.light, lights[i]!.matrix, f32, i);
        do_not_optimize(f32);
      });
    }
  });

  group('Light3dPlugin: pack point lights', () => {
    for (const count of COUNTS) {
      const { lights, f32 } = buildPoint(count);
      bench(`packPointLight × ${count}`, () => {
        for (let i = 0; i < lights.length; i++) packPointLight(lights[i]!.light, lights[i]!.matrix, f32, i);
        do_not_optimize(f32);
      });
    }
  });

  group('Light3dPlugin: pack spot lights', () => {
    for (const count of COUNTS) {
      const { lights, f32 } = buildSpot(count);
      bench(`packSpotLight × ${count}`, () => {
        for (let i = 0; i < lights.length; i++) packSpotLight(lights[i]!.light, lights[i]!.matrix, f32, i);
        do_not_optimize(f32);
      });
    }
  });
});
