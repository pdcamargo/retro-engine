import { describe, expect, it } from 'bun:test';

import { World } from '@retro-engine/ecs';
import { mat4, quat, vec3 } from '@retro-engine/math';

import { composeTransformInto, GlobalTransform, Transform } from './transform';

describe('Transform — defaults', () => {
  it('default ctor yields identity TRS', () => {
    const t = new Transform();
    expect(t.translation[0]).toBe(0);
    expect(t.translation[1]).toBe(0);
    expect(t.translation[2]).toBe(0);
    expect(t.rotation[0]).toBe(0);
    expect(t.rotation[1]).toBe(0);
    expect(t.rotation[2]).toBe(0);
    expect(t.rotation[3]).toBe(1);
    expect(t.scale[0]).toBe(1);
    expect(t.scale[1]).toBe(1);
    expect(t.scale[2]).toBe(1);
  });

  it('two default-constructed Transforms do not share storage', () => {
    const a = new Transform();
    const b = new Transform();
    a.translation[0] = 99;
    expect(b.translation[0]).toBe(0);
  });

  it('ctor accepts explicit fields', () => {
    const t = new Transform(
      vec3.create(1, 2, 3),
      quat.identity(quat.create()),
      vec3.create(4, 5, 6),
    );
    expect(t.translation[0]).toBe(1);
    expect(t.scale[2]).toBe(6);
  });
});

describe('GlobalTransform — defaults', () => {
  it('initial matrix is identity', () => {
    const g = new GlobalTransform();
    const id = mat4.identity();
    for (let i = 0; i < 16; i++) expect(g.matrix[i]).toBe(id[i]!);
  });
});

describe('Required Components — Transform auto-inserts GlobalTransform', () => {
  it('spawning a Transform auto-attaches a default GlobalTransform', () => {
    const world = new World();
    const e = world.spawn(new Transform());
    expect(world.has(e, Transform)).toBe(true);
    expect(world.has(e, GlobalTransform)).toBe(true);
    const g = world.getComponent(e, GlobalTransform);
    const id = mat4.identity();
    for (let i = 0; i < 16; i++) expect(g!.matrix[i]).toBe(id[i]!);
  });

  it('explicit GlobalTransform passed alongside Transform is honoured', () => {
    const world = new World();
    const explicit = new GlobalTransform();
    explicit.matrix[12] = 42; // tag the explicit instance
    const e = world.spawn(new Transform(), explicit);
    const g = world.getComponent(e, GlobalTransform);
    expect(g).toBe(explicit);
    expect(g!.matrix[12]).toBe(42);
  });
});

describe('composeTransformInto', () => {
  it('identity TRS produces identity matrix', () => {
    const out = mat4.create();
    composeTransformInto(out, vec3.create(0, 0, 0), quat.identity(), vec3.create(1, 1, 1));
    const id = mat4.identity();
    for (let i = 0; i < 16; i++) expect(out[i]).toBeCloseTo(id[i]!, 6);
  });

  it('translation only writes translation column', () => {
    const out = mat4.create();
    composeTransformInto(
      out,
      vec3.create(10, 20, 30),
      quat.identity(),
      vec3.create(1, 1, 1),
    );
    expect(out[12]).toBe(10);
    expect(out[13]).toBe(20);
    expect(out[14]).toBe(30);
    expect(out[15]).toBe(1);
    // Upper-left 3x3 stays identity.
    expect(out[0]).toBeCloseTo(1, 6);
    expect(out[5]).toBeCloseTo(1, 6);
    expect(out[10]).toBeCloseTo(1, 6);
  });

  it('scale only scales the diagonal of the upper-left 3x3', () => {
    const out = mat4.create();
    composeTransformInto(out, vec3.create(0, 0, 0), quat.identity(), vec3.create(2, 3, 4));
    expect(out[0]).toBeCloseTo(2, 6);
    expect(out[5]).toBeCloseTo(3, 6);
    expect(out[10]).toBeCloseTo(4, 6);
    expect(out[12]).toBe(0);
    expect(out[13]).toBe(0);
    expect(out[14]).toBe(0);
  });

  it('composing T+R+S applies S, then R, then T to a column vector', () => {
    // Rotate 90° about Z, scale by 2, translate by (10, 0, 0).
    // Applied to point (1, 0, 0): scale → (2, 0, 0), rotate → (0, 2, 0), translate → (10, 2, 0).
    const out = mat4.create();
    const r = quat.fromAxisAngle(vec3.create(0, 0, 1), Math.PI / 2);
    composeTransformInto(out, vec3.create(10, 0, 0), r, vec3.create(2, 2, 1));
    const p = vec3.create(1, 0, 0);
    const transformed = vec3.transformMat4(p, out);
    expect(transformed[0]).toBeCloseTo(10, 5);
    expect(transformed[1]).toBeCloseTo(2, 5);
    expect(transformed[2]).toBeCloseTo(0, 5);
  });

  it('returns the same matrix instance passed in (writes in place)', () => {
    const out = mat4.create();
    const result = composeTransformInto(
      out,
      vec3.create(1, 0, 0),
      quat.identity(),
      vec3.create(1, 1, 1),
    );
    expect(result).toBe(out);
  });
});
