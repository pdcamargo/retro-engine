import { describe, expect, it } from 'bun:test';

import { quat, vec2, vec3 } from '@retro-engine/math';

import { NullPhysicsBackend } from './null-backend';
import { Collider2d, LinearVelocity2d, RigidBody2d } from './components-2d';
import { AngularVelocity3d, Collider3d, LinearVelocity3d, RigidBody3d } from './components-3d';
import {
  angle2dFromQuat,
  applyReadback2d,
  applyReadback3d,
  colliderDesc2d,
  colliderDesc3d,
  snapshot2d,
  snapshot3d,
} from './bridge';

describe('component factories', () => {
  it('RigidBody2d body-type factories', () => {
    expect(RigidBody2d.dynamic().bodyType).toBe('dynamic');
    expect(RigidBody2d.kinematic().bodyType).toBe('kinematic');
    expect(RigidBody2d.fixed().bodyType).toBe('static');
  });

  it('Collider2d shape factories', () => {
    const rect = Collider2d.rectangle(2, 3);
    expect(rect.shape).toBe('rectangle');
    expect([rect.halfExtents[0], rect.halfExtents[1]]).toEqual([2, 3]);
    expect(Collider2d.circle(1.5).radius).toBe(1.5);
    const cap = Collider2d.capsule(1, 0.4);
    expect(cap.shape).toBe('capsule');
    expect(cap.halfHeight).toBe(1);
    expect(cap.radius).toBe(0.4);
  });

  it('Collider3d shape factories', () => {
    const box = Collider3d.cuboid(1, 2, 3);
    expect(box.shape).toBe('cuboid');
    expect([box.halfExtents[0], box.halfExtents[1], box.halfExtents[2]]).toEqual([1, 2, 3]);
    expect(Collider3d.sphere(2).radius).toBe(2);
  });
});

describe('bridge — collider descs', () => {
  it('colliderDesc2d flattens the shape', () => {
    expect(colliderDesc2d(Collider2d.rectangle(2, 3), true)).toEqual({
      shape: 'rectangle',
      radius: 0.5,
      halfExtents: [2, 3],
      halfHeight: 0.5,
      isSensor: true,
    });
  });

  it('colliderDesc3d flattens the shape', () => {
    expect(colliderDesc3d(Collider3d.sphere(1), false)).toEqual({
      shape: 'sphere',
      radius: 1,
      halfExtents: [0.5, 0.5, 0.5],
      halfHeight: 0.5,
      isSensor: false,
    });
  });
});

describe('bridge — angle2dFromQuat', () => {
  it('reads the Z angle from a quaternion', () => {
    expect(angle2dFromQuat(quat.identity())).toBeCloseTo(0, 6);
    const rot = quat.fromEuler(0, 0, Math.PI / 2, 'xyz');
    expect(angle2dFromQuat(rot)).toBeCloseTo(Math.PI / 2, 5);
  });
});

describe('bridge — snapshots', () => {
  it('snapshot2d captures body state', () => {
    const transform = { translation: vec3.create(1, 2, 0), rotation: quat.identity() };
    const snap = snapshot2d(
      RigidBody2d.dynamic(),
      Collider2d.circle(1),
      transform,
      false,
      new LinearVelocity2d(vec2.create(3, 4)),
      5,
      vec2.create(0, -10),
      { restitution: 0.5, friction: 0.2, gravityScale: 2 },
    );
    expect(snap.dimension).toBe('2d');
    expect(snap.bodyType).toBe('dynamic');
    expect(snap.translation).toEqual([1, 2]);
    expect(snap.rotation).toEqual([0]);
    expect(snap.linearVelocity).toEqual([3, 4]);
    expect(snap.angularVelocity).toEqual([5]);
    expect(snap.externalForce).toEqual([0, -10]);
    expect(snap.restitution).toBe(0.5);
    expect(snap.collider.shape).toBe('circle');
  });

  it('snapshot3d captures body state with quaternion rotation', () => {
    const transform = { translation: vec3.create(0, 5, 0), rotation: quat.identity() };
    const snap = snapshot3d(
      RigidBody3d.dynamic(),
      Collider3d.cuboid(1, 1, 1),
      transform,
      false,
      new LinearVelocity3d(vec3.create(0, -9, 0)),
      new AngularVelocity3d(vec3.create(0, 1, 0)),
      undefined,
      {},
    );
    expect(snap.dimension).toBe('3d');
    expect(snap.translation).toEqual([0, 5, 0]);
    expect(snap.rotation).toEqual([0, 0, 0, 1]);
    expect(snap.linearVelocity).toEqual([0, -9, 0]);
    expect(snap.angularVelocity).toEqual([0, 1, 0]);
    expect(snap.friction).toBe(0.5); // default
  });
});

describe('bridge — writeback', () => {
  it('applyReadback2d writes translation, rotation, velocity', () => {
    const transform = { translation: vec3.create(0, 0, 9), rotation: quat.identity() };
    const linear = new LinearVelocity2d();
    applyReadback2d(
      { translation: [7, 8], rotation: [Math.PI / 2], linearVelocity: [1, -1], angularVelocity: [0] },
      transform,
      linear,
    );
    expect([transform.translation[0], transform.translation[1], transform.translation[2]]).toEqual([7, 8, 9]);
    expect(angle2dFromQuat(transform.rotation)).toBeCloseTo(Math.PI / 2, 5);
    expect([linear.value[0], linear.value[1]]).toEqual([1, -1]);
  });

  it('applyReadback3d writes translation, rotation, velocities', () => {
    const transform = { translation: vec3.create(0, 0, 0), rotation: quat.identity() };
    const linear = new LinearVelocity3d();
    const angular = new AngularVelocity3d();
    applyReadback3d(
      { translation: [1, 2, 3], rotation: [0, 0, 0, 1], linearVelocity: [4, 5, 6], angularVelocity: [7, 8, 9] },
      transform,
      linear,
      angular,
    );
    expect([transform.translation[0], transform.translation[1], transform.translation[2]]).toEqual([1, 2, 3]);
    expect([linear.value[0], linear.value[1], linear.value[2]]).toEqual([4, 5, 6]);
    expect([angular.value[0], angular.value[1], angular.value[2]]).toEqual([7, 8, 9]);
  });
});

describe('NullPhysicsBackend', () => {
  it('is inert', () => {
    const backend = new NullPhysicsBackend();
    expect(backend.ready()).toBe(true);
    expect(backend.capabilities.dimensions2d).toBe(false);
    expect(backend.readBody()).toBeUndefined();
    expect(backend.raycast({ dimension: '2d', origin: [0, 0], direction: [1, 0], maxDistance: 10 })).toBeNull();
    expect(backend.drainCollisionEvents()).toEqual([]);
    // These must not throw.
    backend.setGravity();
    backend.step();
    backend.destroy();
  });
});
