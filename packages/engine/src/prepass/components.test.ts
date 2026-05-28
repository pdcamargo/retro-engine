import { describe, expect, it } from 'bun:test';

import {
  DepthPrepass,
  intersectPrepassFlags,
  MotionVectorPrepass,
  NormalPrepass,
  PREPASS_FLAGS_NONE,
  prepassFlagsAny,
} from './components';

describe('prepass markers', () => {
  it('marker classes construct without throwing', () => {
    expect(new DepthPrepass()).toBeInstanceOf(DepthPrepass);
    expect(new NormalPrepass()).toBeInstanceOf(NormalPrepass);
    expect(new MotionVectorPrepass()).toBeInstanceOf(MotionVectorPrepass);
  });

  it('PREPASS_FLAGS_NONE is all false and frozen', () => {
    expect(PREPASS_FLAGS_NONE).toEqual({ depth: false, normal: false, motionVector: false });
    expect(Object.isFrozen(PREPASS_FLAGS_NONE)).toBe(true);
  });

  it('prepassFlagsAny detects at least one set flag', () => {
    expect(prepassFlagsAny(PREPASS_FLAGS_NONE)).toBe(false);
    expect(prepassFlagsAny({ depth: true, normal: false, motionVector: false })).toBe(true);
    expect(prepassFlagsAny({ depth: false, normal: true, motionVector: false })).toBe(true);
    expect(prepassFlagsAny({ depth: false, normal: false, motionVector: true })).toBe(true);
  });

  it('intersectPrepassFlags returns per-channel AND', () => {
    const a = { depth: true, normal: true, motionVector: false };
    const b = { depth: true, normal: false, motionVector: true };
    expect(intersectPrepassFlags(a, b)).toEqual({
      depth: true,
      normal: false,
      motionVector: false,
    });
  });
});
