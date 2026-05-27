// Light3dPlugin shadow CPU hot path (Renderer Phase 10.4 / ADR-0045, Phase 10.5 /
// ADR-0046 cascades):
//
// - `light3d-prepare` builds a light-space view-projection for each shadow-
//   casting light and packs it (plus the caster index) into the GpuLights
//   uniform scratch. Spot / directional-fallback build one matrix per light;
//   cascaded directionals split the camera frustum and build one fitted matrix
//   per cascade. This bench isolates that matrix build + pack at 8 / 64 / 256
//   lights (the larger counts measure the helper's throughput).
// - The depth render + shadow comparison are GPU work and are not measurable
//   from a headless bench (verified in-browser).
//
// See docs/adr/ADR-0017 (bench schema), docs/adr/ADR-0045 (3D shadow maps), and
// docs/adr/ADR-0046 (cascaded shadow maps).

import { bench, do_not_optimize, group, summary } from 'mitata';

import type { Mat4 } from '@retro-engine/math';
import { mat4, quat, vec3 } from '@retro-engine/math';

import { cascadeLightViewProj, computeCascadeSplits } from '../src/light3d/cascade-shadow';
import { MAX_CASCADES } from '../src/light3d/cascade-shadow-config';
import {
  forwardFromMatrix,
  GPU_LIGHTS_FLOAT_COUNT,
  MAX_SHADOW_CASTERS,
  packCascadeSplits,
  packDirectionalCascadeBase,
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

  group('Light3dPlugin: split + fit + pack directional cascade matrices', () => {
    // Cascades fit the camera frustum: one global split set per frame, then a
    // texel-snapped ortho fit per directional light per cascade.
    const invView = mat4.translation(vec3.create(0, 4, 12)) as Mat4;
    const tanHalfFovY = Math.tan(Math.PI / 8);
    const aspect = 16 / 9;
    const splits = new Float32Array(MAX_CASCADES);
    const lightForward = vec3.create();
    for (const count of CASTER_COUNTS) {
      const { transforms, f32, scratch } = buildFixture(count);
      bench(`computeCascadeSplits+cascadeLightViewProj+pack → ${count} dir × ${MAX_CASCADES}`, () => {
        const n = computeCascadeSplits(MAX_CASCADES, 0.1, 150, 0.5, splits);
        packCascadeSplits(f32, splits);
        for (let i = 0; i < transforms.length; i++) {
          forwardFromMatrix(transforms[i]!, lightForward, 0);
          const base = (i * n) % MAX_SHADOW_CASTERS;
          let nearC = 0.1;
          for (let c = 0; c < n; c++) {
            cascadeLightViewProj(
              { invView, tanHalfFovY, aspect, nearC, farC: splits[c]!, lightForward, backExtension: 30 },
              scratch,
            );
            packShadowViewProj(f32, (base + c) % MAX_SHADOW_CASTERS, scratch);
            nearC = splits[c]!;
          }
          packDirectionalCascadeBase(f32, i % 4, base);
        }
        do_not_optimize(f32[0]);
      });
    }
  });
});
