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

describe('RapierBackend — real simulation', () => {
  it('a dynamic box falls under gravity and lands on a static floor', async () => {
    const backend = createRapierBackend();
    await backend.init();
    expect(backend.ready()).toBe(true);
    expect(backend.capabilities.dimensions2d).toBe(true);

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

  it('removeBody drops the body from readback', async () => {
    const backend = createRapierBackend();
    await backend.init();
    backend.upsertBody(e(7), box([0, 5]));
    expect(backend.readBody(e(7))).toBeDefined();
    backend.removeBody(e(7));
    expect(backend.readBody(e(7))).toBeUndefined();
    backend.destroy();
  });

  it('ignores 3D snapshots (2D backend)', async () => {
    const backend = createRapierBackend();
    await backend.init();
    backend.upsertBody(e(1), { ...box([0, 5]), dimension: '3d' });
    expect(backend.readBody(e(1))).toBeUndefined();
    backend.destroy();
  });
});
