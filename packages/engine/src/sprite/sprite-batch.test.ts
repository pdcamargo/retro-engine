import { describe, expect, it } from 'bun:test';

import { mat4, vec2, vec4 } from '@retro-engine/math';

import { Rect, Sprite } from './sprite';
import {
  packSpriteInstance,
  SPRITE_INSTANCE_FLOAT_COUNT,
} from './sprite-batch';

describe('packSpriteInstance', () => {
  it('packs the documented per-instance layout for an identity-transform sprite', () => {
    // Sprite at world (10, 5, 0), customSize 4×6, full-image UV, center anchor,
    // bright orange tint at full opacity. Identity GlobalTransform means
    // basisX/basisY are aligned with world axes scaled by half-width/height …
    // actually with the basis-vector formulation, basisX = width × column-0
    // and basisY = height × column-1, so basisX = (4, 0) and basisY = (0, 6).
    const sprite = new Sprite({
      color: vec4.create(1, 0.5, 0, 1),
      customSize: vec2.create(4, 6),
    });
    const m = mat4.identity();
    // Translation column.
    m[12] = 10;
    m[13] = 5;
    m[14] = 0;

    const buffer = new ArrayBuffer(SPRITE_INSTANCE_FLOAT_COUNT * 4);
    const f32 = new Float32Array(buffer);
    const u32 = new Uint32Array(buffer);
    const consumed = packSpriteInstance(sprite, m, { width: 1, height: 1 }, f32, u32, 0);
    expect(consumed).toBe(SPRITE_INSTANCE_FLOAT_COUNT);

    // basisX = (4, 0), basisY = (0, 6); anchor 'center' (0.5, 0.5) places the
    // unit-quad's (0,0) corner at world (10 - 2, 5 - 3) = (8, 2).
    expect(f32[0]).toBe(8); // center.x
    expect(f32[1]).toBe(2); // center.y
    expect(f32[2]).toBe(4); // basisX.x
    expect(f32[3]).toBe(0); // basisX.y
    expect(f32[4]).toBe(0); // basisY.x
    expect(f32[5]).toBe(6); // basisY.y
    expect(f32[6]).toBe(0); // uvMin.x
    expect(f32[7]).toBe(0); // uvMin.y
    expect(f32[8]).toBe(1); // uvMax.x
    expect(f32[9]).toBe(1); // uvMax.y

    // unorm8x4 RGBA tint, packed little-endian: R | (G<<8) | (B<<16) | (A<<24).
    const expectedColor =
      (255 | (Math.round(0.5 * 255) << 8) | (0 << 16) | (255 << 24)) >>> 0;
    expect(u32[10]).toBe(expectedColor);
  });

  it('swaps UV min/max on the X axis when flipX is set', () => {
    const sprite = new Sprite({
      customSize: vec2.create(2, 2),
      flipX: true,
    });
    const buffer = new ArrayBuffer(SPRITE_INSTANCE_FLOAT_COUNT * 4);
    const f32 = new Float32Array(buffer);
    const u32 = new Uint32Array(buffer);
    packSpriteInstance(sprite, mat4.identity(), { width: 1, height: 1 }, f32, u32, 0);
    // Default rect [0,0]..[1,1] with flipX → uvMin.x=1, uvMax.x=0; Y axis
    // untouched.
    expect(f32[6]).toBe(1); // uvMin.x (was 0)
    expect(f32[7]).toBe(0); // uvMin.y (unchanged)
    expect(f32[8]).toBe(0); // uvMax.x (was 1)
    expect(f32[9]).toBe(1); // uvMax.y (unchanged)
  });

  it('honors a custom rect over the default full-image UV', () => {
    const sprite = new Sprite({
      customSize: vec2.create(2, 2),
      rect: new Rect(vec2.create(0.25, 0.5), vec2.create(0.75, 1)),
    });
    const buffer = new ArrayBuffer(SPRITE_INSTANCE_FLOAT_COUNT * 4);
    const f32 = new Float32Array(buffer);
    const u32 = new Uint32Array(buffer);
    packSpriteInstance(sprite, mat4.identity(), { width: 1, height: 1 }, f32, u32, 0);
    expect(f32[6]).toBe(0.25);
    expect(f32[7]).toBe(0.5);
    expect(f32[8]).toBe(0.75);
    expect(f32[9]).toBe(1);
  });

  it('uses the source image size when customSize is omitted', () => {
    const sprite = new Sprite();
    const buffer = new ArrayBuffer(SPRITE_INSTANCE_FLOAT_COUNT * 4);
    const f32 = new Float32Array(buffer);
    const u32 = new Uint32Array(buffer);
    packSpriteInstance(sprite, mat4.identity(), { width: 32, height: 24 }, f32, u32, 0);
    // basisX = (32, 0), basisY = (0, 24) — image dims drive the footprint.
    expect(f32[2]).toBe(32);
    expect(f32[5]).toBe(24);
  });
});
