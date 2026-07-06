import { describe, expect, it } from 'bun:test';

import { t } from '@retro-engine/reflect';
import type { DecodeEnv, EncodeEnv, RegisteredType, Schema } from '@retro-engine/reflect';
import { decodeComponent, encodeComponent, TypeRegistry } from '@retro-engine/reflect';

import { Collider2d, RigidBody2d } from './components-2d';
import { Collider3d, LinearVelocity3d } from './components-3d';
import { Sensor } from './material';

// Mirrors the schemas PhysicsPlugin registers, exercised against a fresh registry
// so serialization round-trips are verified without an App.
const encEnv = (registry: TypeRegistry): EncodeEnv =>
  ({ registry, entityId: (e) => e as unknown as number, handleRef: (_t, h) => h.guid }) as EncodeEnv;
const decEnv = (registry: TypeRegistry): DecodeEnv =>
  ({
    registry,
    entity: (id: number) => id,
    resolveHandle: () => {
      throw new Error('reflection.test: no handles expected');
    },
  }) as unknown as DecodeEnv;

const roundTrip = <T extends object>(
  reg: TypeRegistry,
  entry: RegisteredType<T>,
  value: T,
): T => decodeComponent(entry, encodeComponent(entry, value, encEnv(reg)), decEnv(reg)) as T;

const register = <T extends object>(
  reg: TypeRegistry,
  ctor: new (...args: never[]) => T,
  schema: Schema<T>,
  name: string,
): RegisteredType<T> => reg.registerComponent(ctor, schema, { name });

describe('physics component reflection round-trip', () => {
  it('RigidBody2d (enum)', () => {
    const reg = new TypeRegistry();
    const entry = register(reg, RigidBody2d, { bodyType: t.enum('dynamic', 'kinematic', 'static') }, 'RigidBody2d');
    expect(roundTrip(reg, entry, RigidBody2d.kinematic()).bodyType).toBe('kinematic');
  });

  it('Collider2d (enum + vec2 + numbers)', () => {
    const reg = new TypeRegistry();
    const entry = register(
      reg,
      Collider2d,
      { shape: t.enum('circle', 'rectangle', 'capsule'), radius: t.number, halfExtents: t.vec2, halfHeight: t.number },
      'Collider2d',
    );
    const back = roundTrip(reg, entry, Collider2d.rectangle(2, 3));
    expect(back.shape).toBe('rectangle');
    expect([back.halfExtents[0], back.halfExtents[1]]).toEqual([2, 3]);
  });

  it('Collider3d (vec3)', () => {
    const reg = new TypeRegistry();
    const entry = register(
      reg,
      Collider3d,
      { shape: t.enum('sphere', 'cuboid', 'capsule'), radius: t.number, halfExtents: t.vec3, halfHeight: t.number },
      'Collider3d',
    );
    const back = roundTrip(reg, entry, Collider3d.cuboid(1, 2, 3));
    expect([back.halfExtents[0], back.halfExtents[1], back.halfExtents[2]]).toEqual([1, 2, 3]);
  });

  it('LinearVelocity3d (vec3)', () => {
    const reg = new TypeRegistry();
    const entry = register(reg, LinearVelocity3d, { value: t.vec3 }, 'LinearVelocity3d');
    const back = roundTrip(reg, entry, new LinearVelocity3d());
    expect([back.value[0], back.value[1], back.value[2]]).toEqual([0, 0, 0]);
  });

  it('Sensor (empty marker)', () => {
    const reg = new TypeRegistry();
    const entry = register(reg, Sensor, {}, 'Sensor');
    expect(roundTrip(reg, entry, new Sensor())).toBeInstanceOf(Sensor);
  });
});
