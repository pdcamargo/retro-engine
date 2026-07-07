import { describe, expect, it } from 'bun:test';

import { vec2 } from '@retro-engine/math';

import { Rect } from './sprite';
import { TextureAtlasLayout } from './texture-atlas-layout';

describe('TextureAtlasLayout.fromGrid', () => {
  it('builds a 4×4 grid of unit-quarter rects on a derived 64×64 source', () => {
    const layout = TextureAtlasLayout.fromGrid({
      tileSize: vec2.create(16, 16),
      columns: 4,
      rows: 4,
    });
    // Derived size: 0 + 4*16 + 3*0 = 64.
    expect(layout.size[0]).toBe(64);
    expect(layout.size[1]).toBe(64);
    expect(layout.textures).toHaveLength(16);

    // Tile (0, 0) — top-left, UV [0, 0.25] × [0, 0.25].
    expect(layout.textures[0]!.min[0]).toBe(0);
    expect(layout.textures[0]!.min[1]).toBe(0);
    expect(layout.textures[0]!.max[0]).toBe(0.25);
    expect(layout.textures[0]!.max[1]).toBe(0.25);

    // Tile (col=1, row=0) — second on the top row. Row-major: index 1.
    expect(layout.textures[1]!.min[0]).toBe(0.25);
    expect(layout.textures[1]!.min[1]).toBe(0);
    expect(layout.textures[1]!.max[0]).toBe(0.5);
    expect(layout.textures[1]!.max[1]).toBe(0.25);

    // Tile (col=0, row=1) — first on the second row. Row-major: index 4.
    expect(layout.textures[4]!.min[0]).toBe(0);
    expect(layout.textures[4]!.min[1]).toBe(0.25);
    expect(layout.textures[4]!.max[0]).toBe(0.25);
    expect(layout.textures[4]!.max[1]).toBe(0.5);

    // Tile (col=3, row=3) — bottom-right, UV [0.75, 1] × [0.75, 1].
    expect(layout.textures[15]!.min[0]).toBe(0.75);
    expect(layout.textures[15]!.min[1]).toBe(0.75);
    expect(layout.textures[15]!.max[0]).toBe(1);
    expect(layout.textures[15]!.max[1]).toBe(1);
  });

  it('honors padding and offset by deriving a larger source size', () => {
    const layout = TextureAtlasLayout.fromGrid({
      tileSize: vec2.create(16, 16),
      columns: 4,
      rows: 4,
      padding: vec2.create(2, 2),
      offset: vec2.create(1, 1),
    });
    // Derived size: offset + cols*tile + (cols-1)*padding = 1 + 64 + 6 = 71.
    expect(layout.size[0]).toBe(71);
    expect(layout.size[1]).toBe(71);

    // First tile: minPx (1, 1), maxPx (17, 17) → uv (1/71, 1/71) .. (17/71, 17/71).
    // Precision 6 (~1e-6) sits comfortably above vec2's f32 storage precision (~1e-7)
    // and well below the precision we'd care about for UV positioning.
    expect(layout.textures[0]!.min[0]).toBeCloseTo(1 / 71, 6);
    expect(layout.textures[0]!.min[1]).toBeCloseTo(1 / 71, 6);
    expect(layout.textures[0]!.max[0]).toBeCloseTo(17 / 71, 6);
    expect(layout.textures[0]!.max[1]).toBeCloseTo(17 / 71, 6);

    // Second column on the top row: minPx (1 + 16 + 2 = 19, 1), maxPx (35, 17).
    expect(layout.textures[1]!.min[0]).toBeCloseTo(19 / 71, 6);
    expect(layout.textures[1]!.max[0]).toBeCloseTo(35 / 71, 6);
  });

  it('produces a 2-wide × 1-tall layout for a single horizontal strip', () => {
    const layout = TextureAtlasLayout.fromGrid({
      tileSize: vec2.create(32, 16),
      columns: 2,
      rows: 1,
    });
    expect(layout.size[0]).toBe(64);
    expect(layout.size[1]).toBe(16);
    expect(layout.textures).toHaveLength(2);
    expect(layout.textures[0]!.min[0]).toBe(0);
    expect(layout.textures[0]!.max[0]).toBe(0.5);
    expect(layout.textures[1]!.min[0]).toBe(0.5);
    expect(layout.textures[1]!.max[0]).toBe(1);
  });

  it('rejects invalid grid dimensions', () => {
    expect(() =>
      TextureAtlasLayout.fromGrid({
        tileSize: vec2.create(16, 16),
        columns: 0,
        rows: 4,
      }),
    ).toThrow();
    expect(() =>
      TextureAtlasLayout.fromGrid({
        tileSize: vec2.create(16, 16),
        columns: 4,
        rows: 1.5,
      }),
    ).toThrow();
    expect(() =>
      TextureAtlasLayout.fromGrid({
        tileSize: vec2.create(0, 16),
        columns: 4,
        rows: 4,
      }),
    ).toThrow();
  });
});

describe('TextureAtlasLayout (sparse / hand-authored)', () => {
  it('round-trips a hand-authored Rect[] without mutation', () => {
    const a = new Rect(vec2.create(0, 0), vec2.create(0.3, 0.4));
    const b = new Rect(vec2.create(0.5, 0.5), vec2.create(1, 1));
    const layout = new TextureAtlasLayout(vec2.create(128, 128), [a, b]);
    expect(layout.size[0]).toBe(128);
    expect(layout.size[1]).toBe(128);
    expect(layout.textures).toHaveLength(2);
    // Same Rect identity — no defensive copy.
    expect(layout.textures[0]).toBe(a);
    expect(layout.textures[1]).toBe(b);
  });
});

describe('TextureAtlasLayout.fromRects', () => {
  it('normalizes hand-placed pixel rects to UV, preserving order', () => {
    // A 100×50 sheet with two irregular sprites.
    const layout = TextureAtlasLayout.fromRects({
      size: vec2.create(100, 50),
      rects: [
        { x: 0, y: 0, width: 40, height: 50 }, // left half-ish
        { x: 50, y: 10, width: 50, height: 30 }, // offset on the right
      ],
    });
    expect(layout.size[0]).toBe(100);
    expect(layout.textures).toHaveLength(2);

    expect(layout.textures[0]!.min[0]).toBe(0);
    expect(layout.textures[0]!.max[0]).toBeCloseTo(0.4, 6);
    expect(layout.textures[0]!.max[1]).toBe(1); // 50/50

    expect(layout.textures[1]!.min[0]).toBe(0.5);
    expect(layout.textures[1]!.min[1]).toBeCloseTo(0.2, 6); // 10/50
    expect(layout.textures[1]!.max[0]).toBe(1); // (50+50)/100
    expect(layout.textures[1]!.max[1]).toBeCloseTo(0.8, 6); // 40/50
  });

  it('rejects a non-positive source size or rect dimension', () => {
    expect(() => TextureAtlasLayout.fromRects({ size: vec2.create(0, 50), rects: [] })).toThrow(
      /size components must be positive/,
    );
    expect(() =>
      TextureAtlasLayout.fromRects({
        size: vec2.create(64, 64),
        rects: [{ x: 0, y: 0, width: 0, height: 10 }],
      }),
    ).toThrow(/positive width\/height/);
  });

  it('produces an empty layout for no rects', () => {
    const layout = TextureAtlasLayout.fromRects({ size: vec2.create(64, 64), rects: [] });
    expect(layout.textures).toHaveLength(0);
    expect(layout.size[0]).toBe(64);
  });
});
