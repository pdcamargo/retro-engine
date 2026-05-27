import { describe, expect, it } from 'bun:test';

import type { Mat4, Vec3 } from '@retro-engine/math';
import { mat4, vec3 } from '@retro-engine/math';

import { MAX_CASCADES } from './cascade-shadow-config';
import { cascadeLightViewProj, computeCascadeSplits, reserveCasterLayers } from './cascade-shadow';
import { MAX_SHADOW_CASTERS, NO_SHADOW_CASTER } from './gpu-lights';
import { SHADOW_MAP_SIZE } from './shadow-3d';

const splitsOut = () => new Float32Array(MAX_CASCADES);

describe('computeCascadeSplits', () => {
  it('returns the clamped cascade count and ends exactly at far', () => {
    const out = splitsOut();
    expect(computeCascadeSplits(3, 1, 100, 0.5, out)).toBe(3);
    expect(out[2]).toBeCloseTo(100);
  });

  it('clamps the cascade count to [1, MAX_CASCADES]', () => {
    const out = splitsOut();
    expect(computeCascadeSplits(0, 1, 100, 0.5, out)).toBe(1);
    expect(computeCascadeSplits(99, 1, 100, 0.5, out)).toBe(MAX_CASCADES);
  });

  it('produces strictly increasing splits', () => {
    const out = splitsOut();
    const n = computeCascadeSplits(4, 0.5, 200, 0.6, out);
    for (let i = 1; i < n; i++) expect(out[i]!).toBeGreaterThan(out[i - 1]!);
  });

  it('lambda = 0 is a uniform split, lambda = 1 is logarithmic', () => {
    const uniform = splitsOut();
    computeCascadeSplits(4, 1, 100, 0, uniform);
    expect(uniform[0]).toBeCloseTo(1 + 99 * 0.25); // 25.75
    expect(uniform[1]).toBeCloseTo(1 + 99 * 0.5); // 50.5

    const log = splitsOut();
    computeCascadeSplits(4, 1, 100, 1, log);
    expect(log[0]).toBeCloseTo(100 ** 0.25); // ~3.162
    expect(log[1]).toBeCloseTo(100 ** 0.5); // 10
  });

  it('pads unused slots with far', () => {
    const out = splitsOut();
    computeCascadeSplits(2, 1, 100, 0.5, out);
    expect(out[1]).toBeCloseTo(100);
    expect(out[2]).toBeCloseTo(100);
    expect(out[3]).toBeCloseTo(100);
  });

  it('clamps an explicit firstCascadeFarBound into a valid range', () => {
    const out = splitsOut();
    computeCascadeSplits(4, 1, 100, 0.5, out, 5);
    expect(out[0]).toBeCloseTo(5);
    // Below the near distance is clamped up to it.
    computeCascadeSplits(4, 2, 100, 0.5, out, 0.1);
    expect(out[0]).toBeCloseTo(2);
  });
});

// A camera-to-world transform (inverse of the view matrix) at `pos` yawed by `yaw`.
const camWorld = (pos: Vec3, yaw: number): Mat4 =>
  mat4.multiply(mat4.translation(pos), mat4.rotationY(yaw)) as Mat4;

const fitParams = (invView: Mat4) => ({
  invView,
  tanHalfFovY: Math.tan(Math.PI / 8), // fov π/4
  aspect: 1.5,
  nearC: 1,
  farC: 20,
  lightForward: vec3.normalize(vec3.create(0.2, -1, 0.3)) as Vec3,
  backExtension: 30,
});

describe('cascadeLightViewProj', () => {
  it('fits the slice so its center projects inside the light NDC box', () => {
    const out = mat4.identity() as Mat4;
    cascadeLightViewProj(fitParams(camWorld(vec3.create(0, 0, 10), 0)), out);
    // Center of the slice along the camera's forward (−Z): ~(0, 0, 10 - 10.5).
    const center = vec3.create(0, 0, -0.5);
    const ndc = vec3.transformMat4(center, out, vec3.create()) as Vec3;
    expect(Math.abs(ndc[0] as number)).toBeLessThanOrEqual(1);
    expect(Math.abs(ndc[1] as number)).toBeLessThanOrEqual(1);
    expect(ndc[2] as number).toBeGreaterThanOrEqual(0);
    expect(ndc[2] as number).toBeLessThanOrEqual(1);
  });

  it('keeps a constant box size as the camera rotates (no shimmer)', () => {
    const a = mat4.identity() as Mat4;
    const b = mat4.identity() as Mat4;
    cascadeLightViewProj(fitParams(camWorld(vec3.create(0, 0, 10), 0)), a);
    cascadeLightViewProj(fitParams(camWorld(vec3.create(0, 0, 10), 0.8)), b);
    // The projection's linear part (which encodes box size + light orientation)
    // is identical; only the translation differs as the slice moves.
    for (const i of [0, 1, 2, 4, 5, 6, 8, 9, 10]) {
      expect(a[i] as number).toBeCloseTo(b[i] as number, 5);
    }
  });

  it('snaps the world origin onto an exact shadow texel (stable under translation)', () => {
    const out = mat4.identity() as Mat4;
    cascadeLightViewProj(fitParams(camWorld(vec3.create(3.3, 1.7, 12.9), 0.4)), out);
    // The world origin's projected NDC.xy lands on a texel center: ndc * size/2 is integral.
    const half = SHADOW_MAP_SIZE * 0.5;
    const sx = (out[12] as number) * half;
    const sy = (out[13] as number) * half;
    expect(Math.abs(sx - Math.round(sx))).toBeLessThan(1e-3);
    expect(Math.abs(sy - Math.round(sy))).toBeLessThan(1e-3);
  });
});

describe('reserveCasterLayers', () => {
  it('returns the base layer when the whole run fits the budget', () => {
    expect(reserveCasterLayers(0, 4)).toBe(0);
    expect(reserveCasterLayers(MAX_SHADOW_CASTERS - 1, 1)).toBe(MAX_SHADOW_CASTERS - 1);
  });

  it('refuses (all-or-nothing) when the run would exceed the budget', () => {
    expect(reserveCasterLayers(MAX_SHADOW_CASTERS - 2, 4)).toBe(NO_SHADOW_CASTER);
    expect(reserveCasterLayers(MAX_SHADOW_CASTERS, 1)).toBe(NO_SHADOW_CASTER);
  });
});
