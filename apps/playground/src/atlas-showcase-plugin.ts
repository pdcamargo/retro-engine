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

const TILE_PX = 32 as const;
const TILE_COLS = 4 as const;
const TILE_ROWS = 4 as const;
const SHEET_PX = TILE_PX * TILE_COLS; // 128 — image is square

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

/**
 * Build a `SHEET_PX × SHEET_PX` RGBA8 image where each `TILE_PX × TILE_PX`
 * tile is a distinct palette colour with its index baked in as visible text
 * (`1` … `16`). Uses the DOM `<canvas>` 2D API so each tile carries
 * unambiguous identity — a sprite rendering "5" is unambiguously sampling
 * tile 5, not "some greenish colour that might be 5 or 11."
 */
const buildTileSheet = (): Image => {
  const canvas = document.createElement('canvas');
  canvas.width = SHEET_PX;
  canvas.height = SHEET_PX;
  const ctx = canvas.getContext('2d');
  if (ctx === null) {
    throw new Error('atlas-showcase: 2D canvas context unavailable');
  }
  // Crisp pixels — no smoothing on the eventual texture upload either (the
  // sampler below pins magFilter/minFilter to nearest).
  ctx.imageSmoothingEnabled = false;

  for (let tr = 0; tr < TILE_ROWS; tr++) {
    for (let tc = 0; tc < TILE_COLS; tc++) {
      const tileIdx = tr * TILE_COLS + tc;
      const [r, g, b] = PALETTE[tileIdx]!;
      const x = tc * TILE_PX;
      const y = tr * TILE_PX;

      ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
      ctx.fillRect(x, y, TILE_PX, TILE_PX);

      // Pick white or black text by perceived luminance — keeps numbers
      // readable across the whole palette.
      const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
      ctx.fillStyle = luminance < 140 ? '#ffffff' : '#000000';
      ctx.font = 'bold 20px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(tileIdx + 1), x + TILE_PX / 2, y + TILE_PX / 2 + 1);
    }
  }

  const imageData = ctx.getImageData(0, 0, SHEET_PX, SHEET_PX);
  // Canvas `Uint8ClampedArray` and engine `Uint8Array` share the same byte
  // layout — wrap, don't copy.
  const data = new Uint8Array(
    imageData.data.buffer,
    imageData.data.byteOffset,
    imageData.data.byteLength,
  );
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
const CELL_SIZE = 48 as const;
const CELL_SPACING = 56 as const;

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
          // Y-up: r=0 should end up at the TOP of the screen, so negate. Without
          // this the visual order is bottom-up and the showcase reads "wrong."
          const py = -(r - (GRID - 1) * 0.5) * CELL_SPACING;
          const index = (c + r * GRID) % tileCount;
          cmd.spawn(
            new Sprite({
              image: sheet,
              color: vec4.create(1, 1, 1, 1),
              customSize: vec2.create(CELL_SIZE, CELL_SIZE),
              // Canvas/PNG textures store row 0 at the top (Y-down memory
              // layout), while the sprite quad's UV(0,0) corner lands at the
              // screen's bottom under Y-up clip space. Without flipY, every
              // textured sprite renders upside-down — visible here as
              // 180°-rotated digits. Mirrors Bevy's Sprite.flip_y semantics.
              flipY: true,
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
