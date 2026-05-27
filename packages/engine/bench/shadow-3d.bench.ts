// Light3dPlugin shadow CPU hot path (Renderer Phase 10.4 / ADR-0045):
//
// - `light3d-prepare` builds a light-space view-projection for each shadow-
//   casting directional / spot light and packs it (plus the caster index) into
//   the GpuLights uniform scratch. This bench isolates that matrix build + pack
//   at 8 / 64 / 256 casters (8 is the per-frame budget; the larger counts
//   measure the helper's throughput).
// - The depth render + shadow comparison are GPU work and are not measurable
//   from a headless bench (verified in-browser).
//
// See docs/adr/ADR-0017 (bench schema) and docs/adr/ADR-0045 (3D shadow maps).

import { bench, do_not_optimize, group, summary } from 'mitata';

import type { Mat4 } from '@retro-engine/math';
import { mat4, quat, vec3 } from '@retro-engine/math';

import {
  GPU_LIGHTS_FLOAT_COUNT,
  MAX_SHADOW_CASTERS,
  packShadowViewProj,
  packSpotCasterIndex,
} from '../src/light3d/gpu-lights';
import {
  directionalLightViewProj,
  spotLightViewProj,
} from '../src/light3d/shadow-3d-matrices';
import { Shadow3dSettings } from '../src/light3d/shadow-3d-settings';

const CASTER_COUNTS = [8, 64, 256] as const;
const settings = new Shadow3dSettings();

const buildFixture = (count: number) => {
  const transforms: Mat4[] = [];
  for (let i = 0; i < count; i++) {
    const m = mat4.fromQuat(quat.fromAxisAngle(vec3.create(1, 0, 0), -Math.PI / 3 - i * 0.01)) as Mat4;
    m[12] = (i % 8) * 3;
    m[13] = 6;
    m[14] = Math.floor(i / 8) * 3;
    transforms.push(m);
  }
  return {
    transforms,
    f32: new Float32Array(GPU_LIGHTS_FLOAT_COUNT),
    scratch: mat4.identity() as Mat4,
  };
};

summary(() => {
  group('Light3dPlugin: build + pack spot light-space shadow matrices', () => {
    for (const count of CASTER_COUNTS) {
      const { transforms, f32, scratch } = buildFixture(count);
      bench(`spotLightViewProj+pack → ${count} casters`, () => {
        for (let i = 0; i < transforms.length; i++) {
          spotLightViewProj(transforms[i]!, Math.PI / 6, 14, settings, scratch);
          packShadowViewProj(f32, i % MAX_SHADOW_CASTERS, scratch);
          packSpotCasterIndex(f32, i % 64, i % MAX_SHADOW_CASTERS);
        }
        do_not_optimize(f32[0]);
      });
    }
  });

  group('Light3dPlugin: build + pack directional light-space shadow matrices', () => {
    for (const count of CASTER_COUNTS) {
      const { transforms, f32, scratch } = buildFixture(count);
      bench(`directionalLightViewProj+pack → ${count} casters`, () => {
        for (let i = 0; i < transforms.length; i++) {
          directionalLightViewProj(transforms[i]!, settings, scratch);
          packShadowViewProj(f32, i % MAX_SHADOW_CASTERS, scratch);
        }
        do_not_optimize(f32[0]);
      });
    }
  });
});
