import { describe, expect, it } from 'bun:test';

import { vec2, vec4 } from '@retro-engine/math';

import { Rect, resolveAnchor, Sprite } from './sprite';

describe('Sprite', () => {
  it('applies documented defaults when constructed empty', () => {
    const s = new Sprite();
    expect(s.image).toBeUndefined();
    expect(Array.from(s.color)).toEqual([1, 1, 1, 1]);
    expect(s.customSize).toBeUndefined();
    expect(s.rect).toBeUndefined();
    expect(s.anchor).toBe('center');
    expect(s.flipX).toBe(false);
    expect(s.flipY).toBe(false);
  });

  it('honors every option supplied', () => {
    const rect = new Rect(vec2.create(0.1, 0.2), vec2.create(0.5, 0.6));
    const s = new Sprite({
      color: vec4.create(0.5, 0.6, 0.7, 0.8),
      customSize: vec2.create(8, 16),
      rect,
      anchor: { x: 0.25, y: 0.75 },
      flipX: true,
      flipY: true,
    });
    // `vec4.create` returns a `Float32Array`; the stored values quantize to
    // f32 precision (0.6 → ~0.6000000238…). Compare per-component with a
    // tolerance instead of an exact-equality on the full array.
    expect(s.color[0]).toBeCloseTo(0.5, 5);
    expect(s.color[1]).toBeCloseTo(0.6, 5);
    expect(s.color[2]).toBeCloseTo(0.7, 5);
    expect(s.color[3]).toBeCloseTo(0.8, 5);
    expect(Array.from(s.customSize!)).toEqual([8, 16]);
    expect(s.rect).toBe(rect);
    expect(s.anchor).toEqual({ x: 0.25, y: 0.75 });
    expect(s.flipX).toBe(true);
    expect(s.flipY).toBe(true);
  });

  it('declares the required-component set Mesh3d carries (Transform + visibility trio)', () => {
    // Sanity check that the required-components list is intact; the engine's
    // required-component resolver relies on the static field's presence.
    expect(Array.isArray(Sprite.requires)).toBe(true);
    expect(Sprite.requires.length).toBeGreaterThanOrEqual(5);
  });
});

describe('resolveAnchor', () => {
  it('maps each named anchor to its [ax, ay] pair', () => {
    expect(resolveAnchor('center')).toEqual([0.5, 0.5]);
    expect(resolveAnchor('topLeft')).toEqual([0, 1]);
    expect(resolveAnchor('topRight')).toEqual([1, 1]);
    expect(resolveAnchor('bottomLeft')).toEqual([0, 0]);
    expect(resolveAnchor('bottomRight')).toEqual([1, 0]);
  });

  it('passes a custom { x, y } through unchanged', () => {
    expect(resolveAnchor({ x: 0.33, y: 0.66 })).toEqual([0.33, 0.66]);
    // Values outside the unit square are allowed — the consumer can offset
    // the sprite above its nominal top by passing y > 1.
    expect(resolveAnchor({ x: -0.5, y: 1.5 })).toEqual([-0.5, 1.5]);
  });
});

describe('Rect', () => {
  it('Rect.full() spans the full image', () => {
    const r = Rect.full();
    expect(Array.from(r.min)).toEqual([0, 0]);
    expect(Array.from(r.max)).toEqual([1, 1]);
  });
});
