import { describe, expect, it } from 'bun:test';

import type { Mat4 } from '@retro-engine/math';
import { mat4, vec3 } from '@retro-engine/math';

import { AmbientLight } from './ambient-light';
import { DirectionalLight3d } from './directional-light-3d';
import {
  forwardFromMatrix,
  GPU_LIGHTS_BYTE_SIZE,
  GPU_LIGHTS_FLOAT_COUNT,
  MAX_DIRECTIONAL_LIGHTS,
  MAX_POINT_LIGHTS,
  packAmbient,
  packCounts,
  packDirectionalLight,
  packPointLight,
  packSpotLight,
} from './gpu-lights';
import { PointLight3d } from './point-light-3d';
import { SpotLight3d } from './spot-light-3d';

// Float offsets into the scratch buffer, mirroring the std140 layout.
const DIRECTIONAL_BASE = 8; // after ambient(4) + counts(4)
const POINT_BASE = DIRECTIONAL_BASE + MAX_DIRECTIONAL_LIGHTS * 8; // 40
const SPOT_BASE = POINT_BASE + MAX_POINT_LIGHTS * 12; // 808

const translation = (x: number, y: number, z: number): Mat4 => {
  const m = mat4.identity();
  m[12] = x;
  m[13] = y;
  m[14] = z;
  return m as Mat4;
};

describe('GpuLights layout constants', () => {
  it('is 7328 bytes / 1832 floats (header + 4 dir + 64 point + 64 spot)', () => {
    expect(GPU_LIGHTS_BYTE_SIZE).toBe(7328);
    expect(GPU_LIGHTS_FLOAT_COUNT).toBe(1832);
    // Spot section ends exactly at the buffer end.
    expect(SPOT_BASE + MAX_POINT_LIGHTS * 16).toBe(GPU_LIGHTS_FLOAT_COUNT);
  });
});

describe('forwardFromMatrix', () => {
  it('returns -Z for an identity matrix', () => {
    const out = new Float32Array(3);
    forwardFromMatrix(mat4.identity(), out, 0);
    expect(out[0]).toBeCloseTo(0);
    expect(out[1]).toBeCloseTo(0);
    expect(out[2]).toBeCloseTo(-1);
  });

  it('normalizes the negated Z basis column', () => {
    const m = mat4.identity();
    // Z basis column (m[8..10]) pointing along +Y, length 2 → forward = -Y.
    m[8] = 0;
    m[9] = 2;
    m[10] = 0;
    const out = new Float32Array(4);
    forwardFromMatrix(m, out, 1);
    expect(out[0]).toBe(0); // untouched slot before outIndex
    expect(out[1]).toBeCloseTo(0);
    expect(out[2]).toBeCloseTo(-1);
    expect(out[3]).toBeCloseTo(0);
  });
});

describe('packAmbient / packCounts', () => {
  it('writes ambient colour + brightness into the header', () => {
    const f32 = new Float32Array(GPU_LIGHTS_FLOAT_COUNT);
    packAmbient(new AmbientLight({ color: vec3.create(0.2, 0.4, 0.6), brightness: 0.3 }), f32);
    expect(f32[0]).toBeCloseTo(0.2);
    expect(f32[1]).toBeCloseTo(0.4);
    expect(f32[2]).toBeCloseTo(0.6);
    expect(f32[3]).toBeCloseTo(0.3);
  });

  it('writes the three counts at u32 slots 4/5/6 and zeroes slot 7', () => {
    const u32 = new Uint32Array(GPU_LIGHTS_FLOAT_COUNT);
    packCounts(u32, 2, 5, 9);
    expect(u32[4]).toBe(2);
    expect(u32[5]).toBe(5);
    expect(u32[6]).toBe(9);
    expect(u32[7]).toBe(0);
  });
});

describe('packDirectionalLight', () => {
  it('packs forward (−Z) + colour/intensity at the directional slot', () => {
    const f32 = new Float32Array(GPU_LIGHTS_FLOAT_COUNT);
    const light = new DirectionalLight3d({ color: vec3.create(1, 2, 3), intensity: 4 });
    packDirectionalLight(light, mat4.identity(), f32, 0);
    expect(f32[DIRECTIONAL_BASE + 0]).toBeCloseTo(0);
    expect(f32[DIRECTIONAL_BASE + 1]).toBeCloseTo(0);
    expect(f32[DIRECTIONAL_BASE + 2]).toBeCloseTo(-1);
    expect(f32[DIRECTIONAL_BASE + 3]).toBe(0);
    expect(f32[DIRECTIONAL_BASE + 4]).toBe(1);
    expect(f32[DIRECTIONAL_BASE + 5]).toBe(2);
    expect(f32[DIRECTIONAL_BASE + 6]).toBe(3);
    expect(f32[DIRECTIONAL_BASE + 7]).toBe(4);
  });

  it('writes the second light one stride (8 floats) along', () => {
    const f32 = new Float32Array(GPU_LIGHTS_FLOAT_COUNT);
    packDirectionalLight(new DirectionalLight3d({ intensity: 9 }), mat4.identity(), f32, 1);
    expect(f32[DIRECTIONAL_BASE + 8 + 7]).toBe(9);
  });
});

describe('packPointLight', () => {
  it('packs position+range, colour+intensity, radius and 1/range²', () => {
    const f32 = new Float32Array(GPU_LIGHTS_FLOAT_COUNT);
    const light = new PointLight3d({ color: vec3.create(0.1, 0.2, 0.3), intensity: 5, range: 4, radius: 1 });
    packPointLight(light, translation(7, 8, 9), f32, 0);
    expect(f32[POINT_BASE + 0]).toBe(7);
    expect(f32[POINT_BASE + 1]).toBe(8);
    expect(f32[POINT_BASE + 2]).toBe(9);
    expect(f32[POINT_BASE + 3]).toBe(4); // range
    expect(f32[POINT_BASE + 4]).toBeCloseTo(0.1);
    expect(f32[POINT_BASE + 7]).toBe(5); // intensity
    expect(f32[POINT_BASE + 8]).toBe(1); // radius
    expect(f32[POINT_BASE + 9]).toBeCloseTo(1 / 16); // 1/range²
  });

  it('uses 1/range² = 0 when range is 0 (avoids divide-by-zero)', () => {
    const f32 = new Float32Array(GPU_LIGHTS_FLOAT_COUNT);
    packPointLight(new PointLight3d({ range: 0 }), translation(0, 0, 0), f32, 0);
    expect(f32[POINT_BASE + 9]).toBe(0);
  });
});

describe('packSpotLight', () => {
  it('packs position+range, cone forward+cosInner, colour, radius+cosOuter+1/range²', () => {
    const f32 = new Float32Array(GPU_LIGHTS_FLOAT_COUNT);
    const light = new SpotLight3d({
      color: vec3.create(1, 0, 0),
      intensity: 2,
      range: 10,
      radius: 0.5,
      innerAngle: 0.3,
      outerAngle: 0.6,
    });
    packSpotLight(light, translation(1, 2, 3), f32, 0);
    expect(f32[SPOT_BASE + 0]).toBe(1);
    expect(f32[SPOT_BASE + 1]).toBe(2);
    expect(f32[SPOT_BASE + 2]).toBe(3);
    expect(f32[SPOT_BASE + 3]).toBe(10); // range
    // direction (forward −Z from identity rotation) + cos(inner)
    expect(f32[SPOT_BASE + 6]).toBeCloseTo(-1);
    expect(f32[SPOT_BASE + 7]).toBeCloseTo(Math.cos(0.3));
    expect(f32[SPOT_BASE + 8]).toBe(1); // colour.r
    expect(f32[SPOT_BASE + 11]).toBe(2); // intensity
    expect(f32[SPOT_BASE + 12]).toBe(0.5); // radius
    expect(f32[SPOT_BASE + 13]).toBeCloseTo(Math.cos(0.6)); // cos(outer)
    expect(f32[SPOT_BASE + 14]).toBeCloseTo(1 / 100); // 1/range²
  });
});
