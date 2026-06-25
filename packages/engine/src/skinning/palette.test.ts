import { mat4, vec3 } from '@retro-engine/math';
import type { Mat4 } from '@retro-engine/math';
import { describe, expect, it } from 'bun:test';

import { computeSkinningPalette } from './palette';
import { SkinnedMeshPalette } from './skeleton';

const sliceMatrix = (palette: SkinnedMeshPalette, i: number): Float32Array =>
  palette.data.slice(i * 16, i * 16 + 16);

const expectMatClose = (a: Float32Array, b: Mat4): void => {
  for (let i = 0; i < 16; i++) expect(a[i]!).toBeCloseTo(b[i] as number, 5);
};

describe('computeSkinningPalette', () => {
  it('yields identity at the bind pose', () => {
    // A joint sitting at its bind position (jointGlobal == bind, so inverseBind
    // is its inverse) with an identity mesh transform produces an identity
    // palette matrix — the vertex is left where it is.
    const bind = mat4.translation(vec3.create(2, 3, 4));
    const inverseBind = mat4.inverse(bind, mat4.create());
    const palette = new SkinnedMeshPalette(1);

    computeSkinningPalette(mat4.identity(), [bind], [inverseBind], palette);

    expectMatClose(sliceMatrix(palette, 0), mat4.identity());
  });

  it('moving a joint past its bind pose deforms by the delta', () => {
    // Bind at the origin; pose translated by +5 on X. palette = jointGlobal *
    // inverseBind = translate(5) * I = translate(5). A bind-space vertex at the
    // origin lands at x=5.
    const bind = mat4.identity();
    const posed = mat4.translation(vec3.create(5, 0, 0));
    const palette = new SkinnedMeshPalette(1);

    computeSkinningPalette(mat4.identity(), [posed], [mat4.inverse(bind, mat4.create())], palette);

    const m = sliceMatrix(palette, 0);
    const p = vec3.transformMat4(vec3.create(0, 0, 0), m, vec3.create());
    expect(p[0]!).toBeCloseTo(5, 5);
  });

  it('folds in inverse(meshGlobal) so the shader model multiply cancels it', () => {
    // meshGlobal moves the mesh by +10 on Y. At the rest pose the palette equals
    // inverse(meshGlobal); the shader re-applies meshGlobal as the per-instance
    // model matrix, so model · palette is identity — the vertex stays put.
    const meshGlobal = mat4.translation(vec3.create(0, 10, 0));
    const bind = mat4.translation(vec3.create(1, 2, 3));
    const palette = new SkinnedMeshPalette(1);

    computeSkinningPalette(meshGlobal, [bind], [mat4.inverse(bind, mat4.create())], palette);

    const modelTimesPalette = mat4.multiply(meshGlobal, sliceMatrix(palette, 0), mat4.create());
    expectMatClose(modelTimesPalette as Float32Array, mat4.identity());
  });

  it('writes an identity slot for a missing joint', () => {
    const palette = new SkinnedMeshPalette(2);
    const bind = mat4.translation(vec3.create(1, 0, 0));

    computeSkinningPalette(
      mat4.identity(),
      [bind, undefined],
      [mat4.inverse(bind, mat4.create()), mat4.identity()],
      palette,
    );

    expectMatClose(sliceMatrix(palette, 0), mat4.identity());
    expectMatClose(sliceMatrix(palette, 1), mat4.identity());
  });
});
