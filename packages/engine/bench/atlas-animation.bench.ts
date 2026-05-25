// atlasAnimationSystem hot path (Renderer Phase 8.4 / ADR-0033):
//
// - Per-frame the atlas-animation system iterates every entity carrying an
//   `AtlasAnimation` (no `Changed<…>` filter), advances its internal timer by
//   `time.virtual.delta`, derives the target frame index from the mode, and
//   writes `atlas.index` + bumps the `TextureAtlas` change tick whenever the
//   target differs from the current.
//
// This bench measures the system end-to-end against a 1000-entity fixture
// driving a 16-frame loop. Each iteration of the measured closure runs the
// system body once with a fixed delta — the realistic cost of one frame's
// worth of animator work for a scene full of independently animated sprites.
//
// Two variants:
//   - all advancing (worst case: every entity computes a fresh index)
//   - all paused   (measures the cheap per-entity short-circuit)
//
// See docs/adr/ADR-0017 (bench schema) and docs/adr/ADR-0033 (atlas-animation).

import { bench, summary } from 'mitata';

import { World } from '@retro-engine/ecs';
import { vec2 } from '@retro-engine/math';

import { AtlasAnimation, atlasAnimationSystem } from '../src/sprite/atlas-animation';
import { TextureAtlas } from '../src/sprite/texture-atlas';
import { TextureAtlasLayout } from '../src/sprite/texture-atlas-layout';
import { TextureAtlasLayouts } from '../src/sprite/texture-atlas-layouts';
import { Time } from '../src/time';

const TOTAL_SPRITES = 1000 as const;

const buildFixture = (paused: boolean): {
  world: World;
  layouts: TextureAtlasLayouts;
  time: Time;
} => {
  const world = new World();
  const layouts = new TextureAtlasLayouts();
  const layout = layouts.add(
    TextureAtlasLayout.fromGrid({
      tileSize: vec2.create(16, 16),
      columns: 4,
      rows: 4,
    }),
  );
  for (let i = 0; i < TOTAL_SPRITES; i++) {
    world.spawn(
      new TextureAtlas(layout, i % 16),
      new AtlasAnimation({
        firstIndex: 0,
        lastIndex: 15,
        fps: 8,
        mode: 'loop',
        paused,
      }),
    );
  }
  const time = new Time();
  // ~60fps delta. Writes through `VirtualClock`'s mutable `delta` field —
  // the system reads `time.virtual.delta` directly, so no full `tick` cycle
  // is needed and the measurement focuses on the system body.
  time.virtual.delta = 1 / 60;
  return { world, layouts, time };
};

summary(() => {
  bench(`atlasAnimationSystem: ${TOTAL_SPRITES} sprites, all advancing`, function* () {
    const { world, time } = buildFixture(false);
    const q = world.query([AtlasAnimation, TextureAtlas]);
    yield () => {
      atlasAnimationSystem(time, q as never, world);
    };
  });

  bench(`atlasAnimationSystem: ${TOTAL_SPRITES} sprites, all paused`, function* () {
    const { world, time } = buildFixture(true);
    const q = world.query([AtlasAnimation, TextureAtlas]);
    yield () => {
      atlasAnimationSystem(time, q as never, world);
    };
  });
});
