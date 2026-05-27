// Light2dPlugin shadow-occluder pack hot path (Renderer Phase 9.4 / ADR-0042):
//
// - The lighting queue transforms every visible occluder's local segments to
//   world space and packs them into the shadow-build uniform via
//   `Light2dShadowState.pushOccluder`. This bench isolates that per-segment
//   transform + write at 16 / 64 / 256 segments (the atlas budget).
// - The shadow-map evaluation itself is GPU-fragment work (the build shader
//   loops the packed segments per atlas texel) and is not measurable from a
//   headless bench.
//
// See docs/adr/ADR-0017 (bench schema) and docs/adr/ADR-0042 (2D shadow
// occluders).

import { bench, do_not_optimize, group, summary } from 'mitata';

import { vec2 } from '@retro-engine/math';

import { LightOccluder2d } from '../src/light2d/light-occluder-2d';
import { Light2dShadowState } from '../src/light2d/light-2d-shadow';
import { GlobalTransform } from '../src/transform';

const SEGMENT_COUNTS = [16, 64, 256] as const;

const buildFixture = (segmentCount: number) => {
  // One rect occluder (4 segments) per cell; place them on a diagonal.
  const occluders: { occluder: LightOccluder2d; gt: GlobalTransform }[] = [];
  const rectCount = Math.ceil(segmentCount / 4);
  for (let i = 0; i < rectCount; i++) {
    const occluder = new LightOccluder2d({
      segments: [
        [vec2.create(-8, -8), vec2.create(8, -8)],
        [vec2.create(8, -8), vec2.create(8, 8)],
        [vec2.create(8, 8), vec2.create(-8, 8)],
        [vec2.create(-8, 8), vec2.create(-8, -8)],
      ],
    });
    const gt = new GlobalTransform();
    gt.matrix[12] = (i % 32) * 40;
    gt.matrix[13] = Math.floor(i / 32) * 40;
    occluders.push({ occluder, gt });
  }
  return { occluders, shadow: new Light2dShadowState() };
};

summary(() => {
  group('Light2dPlugin: pack occluder segments into shadow uniform', () => {
    for (const count of SEGMENT_COUNTS) {
      const { occluders, shadow } = buildFixture(count);
      bench(`pushOccluder → ${count} segments`, () => {
        shadow.beginFrame();
        for (const { occluder, gt } of occluders) {
          shadow.pushOccluder(occluder, gt);
        }
        do_not_optimize(shadow.occluderCount);
      });
    }
  });
});
