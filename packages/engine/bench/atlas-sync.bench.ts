// atlasSyncSystem hot path (Renderer Phase 8.2 / ADR-0032):
//
// - Per-frame the atlas-sync system iterates every entity whose TextureAtlas
//   was mutated since the prior run, looks up its layout asset, and writes
//   `sprite.rect` from `layout.textures[atlas.index]`. This is the per-frame
//   work for any tile-map or character-sheet scene: bumping `atlas.index`
//   on a sprite is how an animator advances frames.
//
// This bench measures the system end-to-end against a 1000-sprite fixture
// sharing one image + one layout. Each iteration of the measured closure
// queries the world for changed TextureAtlas rows and runs the system body —
// the realistic cost of one frame's worth of atlas updates.
//
// See docs/adr/ADR-0017 (bench schema) and docs/adr/ADR-0032 (texture-atlas).

import { bench, summary } from 'mitata';

import { World } from '@retro-engine/ecs';
import { vec2, vec4 } from '@retro-engine/math';

import { atlasSyncSystem } from '../src/sprite/atlas-sync';
import { Sprite } from '../src/sprite/sprite';
import { TextureAtlas } from '../src/sprite/texture-atlas';
import { TextureAtlasLayout } from '../src/sprite/texture-atlas-layout';
import { TextureAtlasLayouts } from '../src/sprite/texture-atlas-layouts';

const TOTAL_SPRITES = 1000 as const;

const buildFixture = (): {
  world: World;
  layouts: TextureAtlasLayouts;
  entities: number[];
} => {
  const world = new World();
  const layouts = new TextureAtlasLayouts();
  const layout = layouts.add(
    TextureAtlasLayout.fromGrid({
      tileSize: vec2.create(16, 16),
      columns: 8,
      rows: 8,
    }),
  );
  const entities: number[] = [];
  for (let i = 0; i < TOTAL_SPRITES; i++) {
    const e = world.spawn(
      new Sprite({
        color: vec4.create(1, 1, 1, 1),
        customSize: vec2.create(16, 16),
      }),
      new TextureAtlas(layout, i % 64),
    );
    entities.push(e as unknown as number);
  }
  return { world, layouts, entities };
};

summary(() => {
  // Steady-state animator: every frame, every sprite's TextureAtlas was
  // re-marked-changed (e.g. each is on its own animation timeline and ticked
  // its index this frame). Worst case for the system's iteration cost.
  bench(`atlasSyncSystem: ${TOTAL_SPRITES} sprites, 100% changed`, function* () {
    const { world, layouts, entities } = buildFixture();
    // First-time query with sinceTick=0 — all spawned entities count as
    // changed since 0. Re-using the same handle across yields keeps the
    // hot-path measurement focused on the system body, not query setup.
    const q = world.query(
      [Sprite, TextureAtlas],
      { changed: [TextureAtlas] },
      0,
    );
    yield () => {
      // Re-arm: bump each TextureAtlas tick so the next iteration sees them
      // as changed. Without this the query would only catch rows whose tick
      // is > 0, which after the first sweep is everyone — but the
      // re-marking ensures the bench reflects a realistic "every frame
      // a fresh batch" pattern.
      for (const e of entities) {
        world.markChanged(e as never, TextureAtlas);
      }
      atlasSyncSystem(layouts, q as never, world);
    };
  });

  // Idle frame: nothing changed since the last sweep. Captures the
  // change-filter early-out cost — the system should iterate zero rows.
  bench(`atlasSyncSystem: ${TOTAL_SPRITES} sprites, 0% changed`, function* () {
    const { world, layouts } = buildFixture();
    const q = world.query(
      [Sprite, TextureAtlas],
      { changed: [TextureAtlas] },
      // Snapshot at current tick — no row's tick is > snapshot, so the
      // filter excludes everyone.
      world.changeTick,
    );
    yield () => {
      atlasSyncSystem(layouts, q as never, world);
    };
  });
});
