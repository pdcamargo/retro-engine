import type { Entity } from '@retro-engine/ecs';
import { mat4 } from '@retro-engine/math';
import { describe, expect, it } from 'bun:test';

import { readAndAdvancePrevViewProj, ViewPreviousFrame } from './extracted';

const e = (id: number): Entity => id as unknown as Entity;

describe('readAndAdvancePrevViewProj', () => {
  it('returns the current matrix on the first call (zero motion vectors)', () => {
    const cache = new ViewPreviousFrame();
    const current = mat4.translation([1, 2, 3]);
    const result = readAndAdvancePrevViewProj(cache, e(7), current);
    expect(Array.from(result)).toEqual(Array.from(current));
    expect(cache.perCamera.has(e(7))).toBe(true);
  });

  it('returns the previously-cached matrix on subsequent calls', () => {
    const cache = new ViewPreviousFrame();
    const frame1 = mat4.translation([1, 0, 0]);
    readAndAdvancePrevViewProj(cache, e(7), frame1);

    const frame2 = mat4.translation([2, 0, 0]);
    const result = readAndAdvancePrevViewProj(cache, e(7), frame2);
    expect(Array.from(result)).toEqual(Array.from(frame1));

    const frame3 = mat4.translation([3, 0, 0]);
    const result3 = readAndAdvancePrevViewProj(cache, e(7), frame3);
    expect(Array.from(result3)).toEqual(Array.from(frame2));
  });

  it('isolates entries per camera entity', () => {
    const cache = new ViewPreviousFrame();
    const aFrame1 = mat4.translation([10, 0, 0]);
    const bFrame1 = mat4.translation([0, 20, 0]);
    readAndAdvancePrevViewProj(cache, e(1), aFrame1);
    readAndAdvancePrevViewProj(cache, e(2), bFrame1);

    const aFrame2 = mat4.translation([11, 0, 0]);
    const aResult = readAndAdvancePrevViewProj(cache, e(1), aFrame2);
    expect(Array.from(aResult)).toEqual(Array.from(aFrame1));

    const bFrame2 = mat4.translation([0, 21, 0]);
    const bResult = readAndAdvancePrevViewProj(cache, e(2), bFrame2);
    expect(Array.from(bResult)).toEqual(Array.from(bFrame1));
  });
});
