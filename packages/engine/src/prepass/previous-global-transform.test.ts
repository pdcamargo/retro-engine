import { mat4 } from '@retro-engine/math';
import { describe, expect, it } from 'bun:test';

import { GlobalTransform } from '../transform';

import { PreviousGlobalTransform } from './previous-global-transform';

describe('PreviousGlobalTransform', () => {
  it('initialises to the identity matrix', () => {
    const prev = new PreviousGlobalTransform();
    expect(Array.from(prev.matrix)).toEqual(Array.from(mat4.identity()));
  });

  it('can be seeded from a GlobalTransform via in-place copy', () => {
    const gt = new GlobalTransform();
    mat4.translation([1, 2, 3], gt.matrix);
    const prev = new PreviousGlobalTransform();
    (prev.matrix as Float32Array).set(gt.matrix as Float32Array);
    expect(Array.from(prev.matrix)).toEqual(Array.from(gt.matrix));
  });

  it('matrix reference is stable across in-place writes', () => {
    const prev = new PreviousGlobalTransform();
    const refBefore = prev.matrix;
    (prev.matrix as Float32Array).set(mat4.translation([4, 5, 6]) as Float32Array);
    expect(prev.matrix).toBe(refBefore);
  });
});

