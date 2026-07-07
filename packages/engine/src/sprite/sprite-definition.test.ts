import { describe, expect, it } from 'bun:test';

import { vec2 } from '@retro-engine/math';

import { DEFAULT_PPU, resolveSpriteDefinition } from './sprite-definition';
import { BorderRect } from './texture-slicer';

describe('resolveSpriteDefinition', () => {
  it('resolves a grid definition into a layout + one sprite per tile', () => {
    const resolved = resolveSpriteDefinition({
      mode: 'multiple',
      source: { kind: 'grid', tileSize: vec2.create(16, 16), columns: 4, rows: 1 },
    });
    expect(resolved.layout.textures).toHaveLength(4);
    expect(resolved.sprites).toHaveLength(4);
    // Each slice is 16×16 px; default pivot + ppu.
    expect([resolved.sprites[0]!.pixelSize[0], resolved.sprites[0]!.pixelSize[1]]).toEqual([16, 16]);
    expect(resolved.sprites[0]!.pivot).toBe('center');
    expect(resolved.sprites[0]!.ppu).toBe(DEFAULT_PPU);
    expect(resolved.sprites[0]!.name).toBe('0');
  });

  it('resolves a manual-rects definition and its pixel sizes', () => {
    const resolved = resolveSpriteDefinition({
      mode: 'multiple',
      source: {
        kind: 'rects',
        size: vec2.create(100, 50),
        rects: [
          { x: 0, y: 0, width: 40, height: 50 },
          { x: 50, y: 10, width: 50, height: 30 },
        ],
      },
      ppu: 50,
    });
    expect(resolved.sprites).toHaveLength(2);
    expect([resolved.sprites[0]!.pixelSize[0], resolved.sprites[0]!.pixelSize[1]]).toEqual([40, 50]);
    expect([resolved.sprites[1]!.pixelSize[0], resolved.sprites[1]!.pixelSize[1]]).toEqual([50, 30]);
    expect(resolved.sprites[1]!.ppu).toBe(50);
  });

  it('applies per-slice overrides (name / pivot / border) by index', () => {
    const border = BorderRect.all(4);
    const resolved = resolveSpriteDefinition({
      mode: 'multiple',
      source: { kind: 'grid', tileSize: vec2.create(32, 32), columns: 2, rows: 1 },
      slices: [
        { name: 'panel', pivot: { x: 0, y: 0 }, border },
        { name: 'icon' },
      ],
    });
    expect(resolved.sprites[0]!.name).toBe('panel');
    expect(resolved.sprites[0]!.pivot).toEqual({ x: 0, y: 0 });
    expect(resolved.sprites[0]!.border).toBe(border);
    expect(resolved.sprites[1]!.name).toBe('icon');
    expect(resolved.sprites[1]!.pivot).toBe('center'); // default when omitted
    expect(resolved.sprites[1]!.border).toBeUndefined();
  });
});
