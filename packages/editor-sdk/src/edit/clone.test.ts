import { describe, expect, it } from 'bun:test';
import type { Color, Vec3 } from '@retro-engine/math';
import { TypeRegistry, t } from '@retro-engine/reflect';

import { snapshotComponent, snapshotValue, valueEquals } from './clone';

class Pos {
  v: Vec3 = new Float32Array([1, 2, 3]);
  tint: Color = { r: 1, g: 0.5, b: 0, a: 1 };
}

describe('snapshotValue', () => {
  it('returns primitives unchanged', () => {
    expect(snapshotValue(5)).toBe(5);
    expect(snapshotValue('x')).toBe('x');
    expect(snapshotValue(null)).toBe(null);
  });

  it('copies typed arrays without aliasing', () => {
    const src = new Float32Array([1, 2, 3]);
    const copy = snapshotValue(src) as Float32Array;
    expect(copy).not.toBe(src);
    expect(Array.from(copy)).toEqual([1, 2, 3]);
    src[0] = 99;
    expect(copy[0]).toBe(1);
  });

  it('deep-copies plain objects and nested typed arrays', () => {
    const src = { v: new Float32Array([1, 2]), c: { r: 1 } };
    const copy = snapshotValue(src) as typeof src;
    expect(copy.v).not.toBe(src.v);
    expect(copy.c).not.toBe(src.c);
    src.v[0] = 99;
    src.c.r = 99;
    expect(copy.v[0]).toBe(1);
    expect(copy.c.r).toBe(1);
  });
});

describe('snapshotComponent', () => {
  it('clones a full instance with its prototype and detached fields', () => {
    const reg = new TypeRegistry();
    const registered = reg.registerComponent(Pos, { v: t.vec3, tint: t.color }, { name: 'Pos' });
    const inst = new Pos();
    const copy = snapshotComponent(registered, inst) as Pos;
    expect(copy).toBeInstanceOf(Pos);
    expect(copy.v).not.toBe(inst.v);
    inst.v[0] = 99;
    inst.tint.r = 99;
    expect(copy.v[0]).toBe(1);
    expect(copy.tint.r).toBe(1);
  });
});

describe('valueEquals', () => {
  it('compares primitives, typed arrays, arrays, and objects structurally', () => {
    expect(valueEquals(1, 1)).toBe(true);
    expect(valueEquals(1, 2)).toBe(false);
    expect(valueEquals(new Float32Array([1, 2]), new Float32Array([1, 2]))).toBe(true);
    expect(valueEquals(new Float32Array([1, 2]), new Float32Array([1, 3]))).toBe(false);
    expect(valueEquals({ r: 1, g: 0 }, { r: 1, g: 0 })).toBe(true);
    expect(valueEquals({ r: 1 }, { r: 1, g: 0 })).toBe(false);
  });
});
