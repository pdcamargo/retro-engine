// Visual harness for Phase 8.2's texture-atlas asset (ADR-0032).
//
// Spawns an 8×8 grid of sprites that all share one procedurally generated
// 64×64 source image and one 4×4 `TextureAtlasLayout`. Each entity carries a
// different `TextureAtlas` index, so the grid cycles visibly through 16
// distinct tile colours. Atlas-sync writes `sprite.rect` per frame in
// `postUpdate` before the sprite-prepare batcher reads it; calculate-sprite-
// bounds populates `Aabb` so the frustum-cull path is active.

import { vec2, vec3, vec4 } from '@retro-engine/math';
import type { Plugin } from '@retro-engine/engine';
import {
  Camera2d,
  ClearColorConfig,
  Commands,
  Image,
  Images,
  ResMut,
  Sprite,
  SpritePlugin,
  TextureAtlas,
  TextureAtlasLayout,
  TextureAtlasLayouts,
  Transform,
} from '@retro-engine/engine';

const TILE_PX = 16 as const;
const TILE_COLS = 4 as const;
const TILE_ROWS = 4 as const;
const SHEET_PX = TILE_PX * TILE_COLS; // 64 — image is square

// 16 distinct tile colours. Picked for visual contrast — neighbours in the
// grid never share a hue family.
const PALETTE: ReadonlyArray<readonly [number, number, number]> = [
  [231, 76, 60], // red
  [230, 126, 34], // orange
  [241, 196, 15], // yellow
  [46, 204, 113], // green
  [26, 188, 156], // teal
  [52, 152, 219], // blue
  [155, 89, 182], // purple
  [231, 76, 167], // pink
  [253, 184, 19], // amber
  [192, 57, 43], // dark red
  [39, 174, 96], // dark green
  [41, 128, 185], // dark blue
  [142, 68, 173], // dark purple
  [44, 62, 80], // navy
  [127, 140, 141], // gray
  [236, 240, 241], // light gray
];

/** Build a 64×64 RGBA8 image where each 16×16 tile is a distinct palette colour. */
const buildTileSheet = (): Image => {
  const data = new Uint8Array(SHEET_PX * SHEET_PX * 4);
  for (let py = 0; py < SHEET_PX; py++) {
    for (let px = 0; px < SHEET_PX; px++) {
      const tc = Math.floor(px / TILE_PX);
      const tr = Math.floor(py / TILE_PX);
      const tileIdx = tr * TILE_COLS + tc;
      const [r, g, b] = PALETTE[tileIdx]!;
      const i = (py * SHEET_PX + px) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  return Image.fromBytes({
    data,
    format: 'rgba8unorm',
    width: SHEET_PX,
    height: SHEET_PX,
    sampler: { magFilter: 'nearest', minFilter: 'nearest' },
    label: 'atlas-showcase-tilesheet',
  });
};

const GRID = 8 as const;
const CELL_SIZE = 28 as const;
const CELL_SPACING = 32 as const;

/**
 * Playground showcase: 8×8 grid (64 entities) of sprites sharing one
 * `TextureAtlas` layout, each entity picking a different tile index. Proves
 * the atlas data path end-to-end: one image, one layout, 64 sprites, one
 * batched draw with per-instance UV.
 */
export const atlasShowcasePlugin: Plugin = (app) => {
  const log = app.logger.child('atlas-showcase');
  app.addPlugin(new SpritePlugin());

  app.addSystem(
    'startup',
    [Commands, ResMut(Images), ResMut(TextureAtlasLayouts)],
    (cmd, images, layouts) => {
      const sheet = images.add(buildTileSheet());
      const layout = layouts.add(
        TextureAtlasLayout.fromGrid({
          tileSize: vec2.create(TILE_PX, TILE_PX),
          columns: TILE_COLS,
          rows: TILE_ROWS,
        }),
      );

      const tileCount = TILE_COLS * TILE_ROWS;
      for (let r = 0; r < GRID; r++) {
        for (let c = 0; c < GRID; c++) {
          const px = (c - (GRID - 1) * 0.5) * CELL_SPACING;
          const py = (r - (GRID - 1) * 0.5) * CELL_SPACING;
          const index = (c + r * GRID) % tileCount;
          cmd.spawn(
            new Sprite({
              image: sheet,
              color: vec4.create(1, 1, 1, 1),
              customSize: vec2.create(CELL_SIZE, CELL_SIZE),
            }),
            new TextureAtlas(layout, index),
            new Transform(vec3.create(px, py, 0)),
          );
        }
      }

      cmd.spawn(
        ...Camera2d({
          clearColor: ClearColorConfig.custom({ r: 0.05, g: 0.07, b: 0.1, a: 1 }),
        }),
      );
      log.info(
        `spawned ${GRID * GRID} sprites sharing one image + one ${TILE_COLS}×${TILE_ROWS} TextureAtlasLayout`,
      );
    },
  );
};
