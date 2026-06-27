// Effective-clip lookup hot path (ADR-0127). Auto-retarget routes every clip
// the sampler resolves through `effectiveClip`, so a foreign clip plays its
// retargeted form. This adds one nested-map lookup per clip resolution per
// frame; this bench isolates that lookup across native (no entry — the common
// case), retargeted (entry present), and an empty map (no auto-retarget path).
//
// See docs/adr/ADR-0017 (bench schema).

import { asAssetIndex, makeHandle } from '@retro-engine/assets';
import type { Entity } from '@retro-engine/ecs';
import { bench, summary } from 'mitata';

import type { AnimationClip } from '../src/animation/animation-clip';
import { EffectiveClips, effectiveClip } from '../src/animation/effective-clips';

const PLAYER_COUNT = 64;
const CLIPS_PER_PLAYER = 4;

const players = Array.from({ length: PLAYER_COUNT }, (_, i) => i as Entity);
const handles = Array.from({ length: CLIPS_PER_PLAYER }, (_, i) =>
  makeHandle<AnimationClip>(asAssetIndex(i)),
);

// Populated map: every clip retargeted to a derived handle (worst case — every
// lookup hits an entry).
const populated = new EffectiveClips();
for (const p of players) {
  for (let i = 0; i < CLIPS_PER_PLAYER; i++) {
    populated.set(p, asAssetIndex(i), makeHandle<AnimationClip>(asAssetIndex(1000 + i)));
  }
}

// Empty map: no auto-retarget path installed — every lookup misses and returns
// the authored handle (the common case for a scene with only native clips).
const empty = new EffectiveClips();

summary(() => {
  bench(`effectiveClip resolve (retargeted) × ${PLAYER_COUNT * CLIPS_PER_PLAYER}`, function* () {
    yield () => {
      let sink = 0;
      for (const p of players) {
        for (const h of handles) sink += effectiveClip(populated, p, h) === null ? 0 : 1;
      }
      return sink;
    };
  });

  bench(`effectiveClip resolve (native miss) × ${PLAYER_COUNT * CLIPS_PER_PLAYER}`, function* () {
    yield () => {
      let sink = 0;
      for (const p of players) {
        for (const h of handles) sink += effectiveClip(empty, p, h) === null ? 0 : 1;
      }
      return sink;
    };
  });

  bench(`effectiveClip resolve (undefined map) × ${PLAYER_COUNT * CLIPS_PER_PLAYER}`, function* () {
    yield () => {
      let sink = 0;
      for (const p of players) {
        for (const h of handles) sink += effectiveClip(undefined, p, h) === null ? 0 : 1;
      }
      return sink;
    };
  });
});
