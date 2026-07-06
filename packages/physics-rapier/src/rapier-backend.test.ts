import { describe, expect, it } from 'bun:test';

import type { Entity } from '@retro-engine/ecs';
import type { BodySnapshot } from '@retro-engine/physics-core';

import { createRapierBackend } from './rapier-backend';

const e = (n: number): Entity => n as Entity;

const box = (translation: readonly number[], half = 0.5): BodySnapshot => ({
  dimension: '2d',
  bodyType: 'dynamic',
  translation,
  rotation: [0],
  collider: { shape: 'rectangle', radius: 0.5, halfExtents: [half, half], halfHeight: half, isSensor: false },
  linearVelocity: [0, 0],
  angularVelocity: [0],
  externalForce: [0, 0],
  restitution: 0,
  friction: 0.5,
  gravityScale: 1,
});

const floor = (): BodySnapshot => ({
  dimension: '2d',
  bodyType: 'static',
  translation: [0, 0],
  rotation: [0],
  collider: { shape: 'rectangle', radius: 0.5, halfExtents: [50, 0.5], halfHeight: 0.5, isSensor: false },
  linearVelocity: [0, 0],
  angularVelocity: [0],
  externalForce: [0, 0],
  restitution: 0,
  friction: 0.5,
  gravityScale: 1,
});

const box3d = (translation: readonly number[]): BodySnapshot => ({
  dimension: '3d',
  bodyType: 'dynamic',
  translation,
  rotation: [0, 0, 0, 1],
  collider: { shape: 'cuboid', radius: 0.5, halfExtents: [0.5, 0.5, 0.5], halfHeight: 0.5, isSensor: false },
  linearVelocity: [0, 0, 0],
  angularVelocity: [0, 0, 0],
  externalForce: [0, 0, 0],
  restitution: 0,
  friction: 0.5,
  gravityScale: 1,
});

const floor3d = (): BodySnapshot => ({
  dimension: '3d',
  bodyType: 'static',
  translation: [0, 0, 0],
  rotation: [0, 0, 0, 1],
  collider: { shape: 'cuboid', radius: 0.5, halfExtents: [50, 0.5, 50], halfHeight: 0.5, isSensor: false },
  linearVelocity: [0, 0, 0],
  angularVelocity: [0, 0, 0],
  externalForce: [0, 0, 0],
  restitution: 0,
  friction: 0.5,
  gravityScale: 1,
});

describe('RapierBackend — real simulation', () => {
  it('a dynamic box falls under gravity and lands on a static floor', async () => {
    const backend = createRapierBackend();
    await backend.init();
    expect(backend.ready()).toBe(true);
    expect(backend.capabilities.dimensions2d).toBe(true);

    expect(backend.capabilities.dimensions3d).toBe(true);
    backend.setGravity('2d', [0, -9.81]);
    backend.upsertBody(e(1), floor());
    backend.upsertBody(e(2), box([0, 5]));

    const startY = backend.readBody(e(2))!.translation[1]!;
    for (let i = 0; i < 240; i += 1) backend.step(1 / 60);
    const endY = backend.readBody(e(2))!.translation[1]!;

    expect(endY).toBeLessThan(startY); // it fell
    // Rests on the floor: floor top (0.5) + box half-height (0.5) = 1.0.
    expect(endY).toBeGreaterThan(0.8);
    expect(endY).toBeLessThan(1.2);

    backend.destroy();
  });

  it('a 3D box falls under gravity and lands on a static floor', async () => {
    const backend = createRapierBackend();
    await backend.init();
    backend.setGravity('3d', [0, -9.81, 0]);
    backend.upsertBody(e(1), floor3d());
    backend.upsertBody(e(2), box3d([0, 5, 0]));

    const readback0 = backend.readBody(e(2))!;
    expect(readback0.translation).toHaveLength(3);
    expect(readback0.rotation).toHaveLength(4); // quaternion
    const startY = readback0.translation[1]!;
    for (let i = 0; i < 240; i += 1) backend.step(1 / 60);
    const endY = backend.readBody(e(2))!.translation[1]!;

    expect(endY).toBeLessThan(startY);
    expect(endY).toBeGreaterThan(0.8);
    expect(endY).toBeLessThan(1.2);

    backend.destroy();
  });

  it('gravityScale 0 keeps a body floating', async () => {
    const backend = createRapierBackend();
    await backend.init();
    backend.setGravity('2d', [0, -9.81]);
    const floating = { ...box([0, 5]), gravityScale: 0 };
    backend.upsertBody(e(1), floating);
    for (let i = 0; i < 120; i += 1) backend.step(1 / 60);
    expect(backend.readBody(e(1))!.translation[1]!).toBeCloseTo(5, 1);
    backend.destroy();
  });

  it('emits a collision "started" event when a box lands on the floor', async () => {
    const backend = createRapierBackend();
    await backend.init();
    backend.setGravity('2d', [0, -9.81]);
    backend.upsertBody(e(1), floor());
    backend.upsertBody(e(2), box([0, 3]));

    const started: { a: number; b: number }[] = [];
    for (let i = 0; i < 240; i += 1) {
      backend.step(1 / 60);
      for (const ev of backend.drainCollisionEvents()) {
        if (ev.kind === 'started') started.push({ a: ev.a as number, b: ev.b as number });
      }
    }
    expect(started.length).toBeGreaterThan(0);
    const pair = [started[0]!.a, started[0]!.b].sort((x, y) => x - y);
    expect(pair).toEqual([1, 2]); // floor (e1) ↔ box (e2)
    backend.destroy();
  });

  it('removeBody drops the body from readback', async () => {
    const backend = createRapierBackend();
    await backend.init();
    backend.upsertBody(e(7), box([0, 5]));
    expect(backend.readBody(e(7))).toBeDefined();
    backend.removeBody(e(7));
    expect(backend.readBody(e(7))).toBeUndefined();
    backend.destroy();
  });

  it('simulates 2D and 3D bodies independently in one backend', async () => {
    const backend = createRapierBackend();
    await backend.init();
    backend.setGravity('2d', [0, -9.81]);
    backend.setGravity('3d', [0, -9.81, 0]);
    backend.upsertBody(e(1), floor());
    backend.upsertBody(e(2), box([0, 5]));
    backend.upsertBody(e(3), floor3d());
    backend.upsertBody(e(4), box3d([0, 5, 0]));
    for (let i = 0; i < 240; i += 1) backend.step(1 / 60);
    // Both boxes came to rest on their respective floors.
    expect(backend.readBody(e(2))!.translation[1]!).toBeGreaterThan(0.8);
    expect(backend.readBody(e(4))!.translation[1]!).toBeGreaterThan(0.8);
    backend.destroy();
  });
});
