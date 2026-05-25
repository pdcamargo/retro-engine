import { describe, expect, it } from 'bun:test';

import { mat4, vec2, vec4 } from '@retro-engine/math';

import {
  App,
  AtlasAnimation,
  BorderRect,
  Camera2d,
  Image,
  Images,
  packSpriteInstance,
  Sprite,
  SPRITE_INSTANCE_BYTE_SIZE,
  SPRITE_INSTANCE_FLOAT_COUNT,
  SpriteInstanceBuffer,
  SpritePlugin,
  TextureAtlas,
  TextureAtlasLayout,
  TextureAtlasLayouts,
  TextureSlicer,
} from '../index';
import { makeCapturingRenderer, makeStubCanvas } from '../test-utils';

/** Read one slice's relevant fields out of the packed Float32 buffer. */
const readSlice = (
  f32: Float32Array,
  i: number,
): {
  centerX: number;
  centerY: number;
  basisXx: number;
  basisYy: number;
  uMin: number;
  vMin: number;
  uMax: number;
  vMax: number;
} => {
  const b = i * SPRITE_INSTANCE_FLOAT_COUNT;
  return {
    centerX: f32[b + 0] as number,
    centerY: f32[b + 1] as number,
    basisXx: f32[b + 2] as number,
    basisYy: f32[b + 5] as number,
    uMin: f32[b + 6] as number,
    vMin: f32[b + 7] as number,
    uMax: f32[b + 8] as number,
    vMax: f32[b + 9] as number,
  };
};

describe('packSpriteInstance — 9-slice routing', () => {
  it('emits 9 instances tiling 96×96 with symmetric border 8 against a 32×32 source', () => {
    const sprite = new Sprite({
      color: vec4.create(1, 1, 1, 1),
      customSize: vec2.create(96, 96),
      imageMode: {
        kind: 'sliced',
        slicer: new TextureSlicer({ border: BorderRect.all(8) }),
      },
    });
    const m = mat4.identity(); // identity affine, translation = (0, 0, 0)

    const buffer = new ArrayBuffer(9 * SPRITE_INSTANCE_BYTE_SIZE);
    const f32 = new Float32Array(buffer);
    const u32 = new Uint32Array(buffer);
    const consumed = packSpriteInstance(sprite, m, { width: 32, height: 32 }, f32, u32, 0);
    expect(consumed).toBe(9 * SPRITE_INSTANCE_FLOAT_COUNT);

    // Order BL, BM, BR, ML, MM, MR, TL, TM, TR (rows bottom-up, cols left-to-right).
    // Column widths repeat per row: 8, 80, 8. Row heights repeat per column: 8, 80, 8.
    const expectedWidths = [8, 80, 8, 8, 80, 8, 8, 80, 8];
    const expectedHeights = [8, 8, 8, 80, 80, 80, 8, 8, 8];
    for (let i = 0; i < 9; i++) {
      const s = readSlice(f32, i);
      expect(s.basisXx).toBeCloseTo(expectedWidths[i]!, 5);
      expect(s.basisYy).toBeCloseTo(expectedHeights[i]!, 5);
    }

    // Bottom-row column boundaries — anchor 'center' lands the footprint
    // origin at (0, 0), so the BL corner sits at (-48, -48) and BR sits at
    // (+40, -48). The vertex shader places the (0, 0) corner at `center`;
    // `centerX` therefore equals each slice's bottom-left X in world units.
    expect(readSlice(f32, 0).centerX).toBeCloseTo(-48, 5);
    expect(readSlice(f32, 1).centerX).toBeCloseTo(-40, 5);
    expect(readSlice(f32, 2).centerX).toBeCloseTo(40, 5);
    // And the right edge of the right-corner slice = centerX + basisXx = 48,
    // exactly the footprint's right edge.
    const br = readSlice(f32, 2);
    expect(br.centerX + br.basisXx).toBeCloseTo(48, 5);

    // Bottom row's Y is constant — all three corners + bottom edge sit at
    // y = -48 with height 8.
    for (const i of [0, 1, 2]) {
      expect(readSlice(f32, i).centerY).toBeCloseTo(-48, 5);
    }
    // Top row Y = +40, height 8 → right edge = 48.
    for (const i of [6, 7, 8]) {
      const s = readSlice(f32, i);
      expect(s.centerY).toBeCloseTo(40, 5);
      expect(s.centerY + s.basisYy).toBeCloseTo(48, 5);
    }

    // UVs split at 8/32 = 0.25 and 1 − 8/32 = 0.75. Same pattern in U and V
    // because the source is square and the border is symmetric.
    const bl = readSlice(f32, 0);
    expect(bl.uMin).toBeCloseTo(0, 5);
    expect(bl.uMax).toBeCloseTo(0.25, 5);
    expect(bl.vMin).toBeCloseTo(0, 5);
    expect(bl.vMax).toBeCloseTo(0.25, 5);
    const mm = readSlice(f32, 4);
    expect(mm.uMin).toBeCloseTo(0.25, 5);
    expect(mm.uMax).toBeCloseTo(0.75, 5);
    expect(mm.vMin).toBeCloseTo(0.25, 5);
    expect(mm.vMax).toBeCloseTo(0.75, 5);
    const tr = readSlice(f32, 8);
    expect(tr.uMin).toBeCloseTo(0.75, 5);
    expect(tr.uMax).toBeCloseTo(1, 5);
    expect(tr.vMin).toBeCloseTo(0.75, 5);
    expect(tr.vMax).toBeCloseTo(1, 5);
  });

  it('packs the right per-corner size + UV for an asymmetric border (4, 12, 6, 8)', () => {
    // BorderRect(left=4, right=12, top=6, bottom=8). Footprint 96×96; source
    // 32×32. Column widths 4 / 80 / 12 (X). Row heights 8 / 82 / 6 (Y-up:
    // bottom → middle → top). UV column ranges [0, 0.125] / [0.125, 0.625] /
    // [0.625, 1]; UV row ranges [0, 0.25] / [0.25, 0.8125] / [0.8125, 1].
    const sprite = new Sprite({
      customSize: vec2.create(96, 96),
      imageMode: {
        kind: 'sliced',
        slicer: new TextureSlicer({ border: new BorderRect(4, 12, 6, 8) }),
      },
    });
    const buffer = new ArrayBuffer(9 * SPRITE_INSTANCE_BYTE_SIZE);
    const f32 = new Float32Array(buffer);
    const u32 = new Uint32Array(buffer);
    packSpriteInstance(sprite, mat4.identity(), { width: 32, height: 32 }, f32, u32, 0);

    const widths = [4, 80, 12, 4, 80, 12, 4, 80, 12];
    const heights = [8, 8, 8, 82, 82, 82, 6, 6, 6];
    for (let i = 0; i < 9; i++) {
      const s = readSlice(f32, i);
      expect(s.basisXx).toBeCloseTo(widths[i]!, 5);
      expect(s.basisYy).toBeCloseTo(heights[i]!, 5);
    }
    // Sum-of-column-widths and sum-of-row-heights tile the footprint exactly.
    expect(widths[0]! + widths[1]! + widths[2]!).toBeCloseTo(96, 5);
    expect(heights[0]! + heights[3]! + heights[6]!).toBeCloseTo(96, 5);

    // Spot-check corner UVs: BL is [0, 0.125] × [0, 0.25]; TR is
    // [0.625, 1] × [0.8125, 1].
    const bl = readSlice(f32, 0);
    expect(bl.uMin).toBeCloseTo(0, 5);
    expect(bl.uMax).toBeCloseTo(0.125, 5);
    expect(bl.vMin).toBeCloseTo(0, 5);
    expect(bl.vMax).toBeCloseTo(0.25, 5);
    const tr = readSlice(f32, 8);
    expect(tr.uMin).toBeCloseTo(0.625, 5);
    expect(tr.uMax).toBeCloseTo(1, 5);
    expect(tr.vMin).toBeCloseTo(0.8125, 5);
    expect(tr.vMax).toBeCloseTo(1, 5);
  });

  it('default imageMode (undefined) still packs exactly one instance', () => {
    const sprite = new Sprite({
      customSize: vec2.create(4, 4),
      color: vec4.create(1, 1, 1, 1),
    });
    const buffer = new ArrayBuffer(SPRITE_INSTANCE_BYTE_SIZE);
    const f32 = new Float32Array(buffer);
    const u32 = new Uint32Array(buffer);
    const consumed = packSpriteInstance(
      sprite,
      mat4.identity(),
      { width: 1, height: 1 },
      f32,
      u32,
      0,
    );
    expect(consumed).toBe(SPRITE_INSTANCE_FLOAT_COUNT);
  });

  it('atlassed + sliced: one entity contributes 9 instances inside the tile UV', async () => {
    const { renderer } = makeCapturingRenderer();
    const app = new App({ renderer, canvas: makeStubCanvas() });
    app.addPlugin(new SpritePlugin());

    const images = app.getResource(Images)!;
    const layouts = app.getResource(TextureAtlasLayouts)!;
    // 4 columns × 1 row of 32×32 tiles → 128×32 atlas. The image dimensions
    // must match the layout's claimed size for the border (in source-image
    // pixels) to land where the consumer expects.
    const atlasBytes = new Uint8Array(128 * 32 * 4).fill(255);
    const sheet = images.add(
      Image.fromBytes({
        data: atlasBytes,
        format: 'rgba8unorm',
        width: 128,
        height: 32,
        label: 'panel-atlas',
      }),
    );
    const layout = layouts.add(
      TextureAtlasLayout.fromGrid({ tileSize: vec2.create(32, 32), columns: 4, rows: 1 }),
    );

    app.world.spawn(
      new Sprite({
        image: sheet,
        customSize: vec2.create(48, 48),
        imageMode: {
          kind: 'sliced',
          slicer: new TextureSlicer({ border: BorderRect.all(4) }),
        },
      }),
      new TextureAtlas(layout, 2),
    );
    app.world.spawn(...Camera2d());

    await app.run();

    const buf = app.getResource(SpriteInstanceBuffer)!;
    expect(buf.count).toBe(9);

    // Tile index 2 on a 4-column layout spans u ∈ [0.5, 0.75]; every packed
    // slice's UV must live inside that range (with v in [0, 1]).
    for (let i = 0; i < 9; i++) {
      const s = readSlice(buf.scratchF32, i);
      const uLo = Math.min(s.uMin, s.uMax);
      const uHi = Math.max(s.uMin, s.uMax);
      const vLo = Math.min(s.vMin, s.vMax);
      const vHi = Math.max(s.vMin, s.vMax);
      expect(uLo).toBeGreaterThanOrEqual(0.5 - 1e-6);
      expect(uHi).toBeLessThanOrEqual(0.75 + 1e-6);
      expect(vLo).toBeGreaterThanOrEqual(-1e-6);
      expect(vHi).toBeLessThanOrEqual(1 + 1e-6);
    }
  });

  it('animated + sliced: animator advances atlas.index and the 9 slices follow the new tile', async () => {
    const { renderer } = makeCapturingRenderer();
    const app = new App({ renderer, canvas: makeStubCanvas() });
    app.addPlugin(new SpritePlugin());

    const images = app.getResource(Images)!;
    const layouts = app.getResource(TextureAtlasLayouts)!;
    const atlasBytes = new Uint8Array(128 * 32 * 4).fill(255);
    const sheet = images.add(
      Image.fromBytes({
        data: atlasBytes,
        format: 'rgba8unorm',
        width: 128,
        height: 32,
        label: 'panel-atlas',
      }),
    );
    const layout = layouts.add(
      TextureAtlasLayout.fromGrid({ tileSize: vec2.create(32, 32), columns: 4, rows: 1 }),
    );

    const e = app.world.spawn(
      new Sprite({
        image: sheet,
        customSize: vec2.create(48, 48),
        imageMode: {
          kind: 'sliced',
          slicer: new TextureSlicer({ border: BorderRect.all(4) }),
        },
      }),
      new TextureAtlas(layout, 0),
      // fps = 25 puts `floor(0.1 × 25) = floor(2.5) = 2` in the interior of
      // the integer interval, robust to the ±1ulp drift that
      // `(T1+100) − T1` can introduce in floating-point arithmetic on a busy
      // test runner (an fps near a step boundary, e.g. 20 → 2.0 exactly,
      // flakes here).
      new AtlasAnimation({ firstIndex: 0, lastIndex: 3, fps: 25, mode: 'loop' }),
    );
    app.world.spawn(...Camera2d());

    // `app.run()` seeds the animator at a wall-clock timestamp; capture it
    // and advance the next frame by exactly 100 ms. `Time.tick` clamps the
    // per-frame delta to 100 ms (hitch protection), so this is the largest
    // single-frame delta the engine will surface.
    await app.run();
    const prevTimestamp = app.currentFrameTimestamp();
    app.advanceFrame(prevTimestamp + 100);

    // Sanity: animator ticked the atlas to index 2 (2 steps of the loop),
    // and atlas-sync propagated the new tile UV onto sprite.rect.
    expect(app.world.getComponent(e, TextureAtlas)!.index).toBe(2);
    const sprite = app.world.getComponent(e, Sprite)!;
    expect(sprite.rect).toBeDefined();

    const buf = app.getResource(SpriteInstanceBuffer)!;
    expect(buf.count).toBe(9);
    // All 9 slices now sample inside tile 2 (u ∈ [0.5, 0.75]).
    for (let i = 0; i < 9; i++) {
      const s = readSlice(buf.scratchF32, i);
      const uLo = Math.min(s.uMin, s.uMax);
      const uHi = Math.max(s.uMin, s.uMax);
      expect(uLo).toBeGreaterThanOrEqual(0.5 - 1e-6);
      expect(uHi).toBeLessThanOrEqual(0.75 + 1e-6);
    }
  });
});
