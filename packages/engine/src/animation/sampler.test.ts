import { describe, expect, it } from 'bun:test';

import type { KeyframeSampler } from './animation-clip';
import { sampleInto } from './sampler';

const near = (a: number, b: number, eps = 1e-5): boolean => Math.abs(a - b) <= eps;

describe('sampleInto — LINEAR', () => {
  it('interpolates a scalar between keyframes', () => {
    const sampler: KeyframeSampler = {
      times: new Float32Array([0, 1]),
      values: new Float32Array([0, 10]),
      componentCount: 1,
      interpolation: 'LINEAR',
    };
    const out = new Float32Array(1);
    sampleInto(sampler, 0.25, false, out);
    expect(near(out[0]!, 2.5)).toBe(true);
  });

  it('interpolates a vec3 component-wise', () => {
    const sampler: KeyframeSampler = {
      times: new Float32Array([0, 1]),
      values: new Float32Array([0, 0, 0, 2, 4, 6]),
      componentCount: 3,
      interpolation: 'LINEAR',
    };
    const out = new Float32Array(3);
    sampleInto(sampler, 0.5, false, out);
    expect(near(out[0]!, 1)).toBe(true);
    expect(near(out[1]!, 2)).toBe(true);
    expect(near(out[2]!, 3)).toBe(true);
  });

  it('clamps before the first and after the last keyframe', () => {
    const sampler: KeyframeSampler = {
      times: new Float32Array([1, 2]),
      values: new Float32Array([5, 9]),
      componentCount: 1,
      interpolation: 'LINEAR',
    };
    const out = new Float32Array(1);
    sampleInto(sampler, 0, false, out);
    expect(out[0]).toBe(5);
    sampleInto(sampler, 100, false, out);
    expect(out[0]).toBe(9);
  });

  it('holds the only keyframe of a single-key sampler', () => {
    const sampler: KeyframeSampler = {
      times: new Float32Array([3]),
      values: new Float32Array([7, 8, 9]),
      componentCount: 3,
      interpolation: 'LINEAR',
    };
    const out = new Float32Array(3);
    sampleInto(sampler, 999, false, out);
    expect([out[0], out[1], out[2]]).toEqual([7, 8, 9]);
  });
});

describe('sampleInto — quaternion slerp', () => {
  const r45 = Math.SQRT1_2; // sin/cos of 45°

  it('slerps the short way and stays normalized (identity → 90° about Y)', () => {
    const sampler: KeyframeSampler = {
      times: new Float32Array([0, 1]),
      values: new Float32Array([0, 0, 0, 1, 0, r45, 0, r45]),
      componentCount: 4,
      interpolation: 'LINEAR',
    };
    const out = new Float32Array(4);
    sampleInto(sampler, 0.5, true, out);
    // Halfway between identity and 90°-about-Y is 45°-about-Y.
    expect(near(out[0]!, 0)).toBe(true);
    expect(near(out[1]!, Math.sin(Math.PI / 8))).toBe(true);
    expect(near(out[2]!, 0)).toBe(true);
    expect(near(out[3]!, Math.cos(Math.PI / 8))).toBe(true);
    expect(near(Math.hypot(out[0]!, out[1]!, out[2]!, out[3]!), 1)).toBe(true);
  });

  it('takes the shortest path across an antipodal keyframe', () => {
    // q and -q are the same rotation; blending them must stay at that rotation,
    // not spin a full turn through the long arc.
    const sampler: KeyframeSampler = {
      times: new Float32Array([0, 1]),
      values: new Float32Array([0, 0, 0, 1, 0, 0, 0, -1]),
      componentCount: 4,
      interpolation: 'LINEAR',
    };
    const out = new Float32Array(4);
    sampleInto(sampler, 0.5, true, out);
    expect(near(Math.abs(out[3]!), 1)).toBe(true);
    expect(near(out[0]!, 0)).toBe(true);
    expect(near(out[1]!, 0)).toBe(true);
    expect(near(out[2]!, 0)).toBe(true);
  });
});

describe('sampleInto — STEP', () => {
  it('holds the previous keyframe with no blend', () => {
    const sampler: KeyframeSampler = {
      times: new Float32Array([0, 1, 2]),
      values: new Float32Array([10, 20, 30]),
      componentCount: 1,
      interpolation: 'STEP',
    };
    const out = new Float32Array(1);
    sampleInto(sampler, 0.99, false, out);
    expect(out[0]).toBe(10);
    sampleInto(sampler, 1.0, false, out);
    expect(out[0]).toBe(20);
    sampleInto(sampler, 1.5, false, out);
    expect(out[0]).toBe(20);
  });
});

describe('sampleInto — CUBICSPLINE', () => {
  it('reduces to smoothstep with zero tangents', () => {
    // Per-keyframe layout is [inTangent, value, outTangent].
    const sampler: KeyframeSampler = {
      times: new Float32Array([0, 1]),
      values: new Float32Array([0, 0, 0, /* k0 */ 0, 10, 0 /* k1 */]),
      componentCount: 1,
      interpolation: 'CUBICSPLINE',
    };
    const out = new Float32Array(1);
    sampleInto(sampler, 0.5, false, out);
    // h00(0.5)=0.5, h01(0.5)=0.5 → 0.5*0 + 0.5*10 = 5.
    expect(near(out[0]!, 5)).toBe(true);
  });
});
