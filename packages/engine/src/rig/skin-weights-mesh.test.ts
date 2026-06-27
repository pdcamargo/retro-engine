import { describe, expect, it } from 'bun:test';

import { Mesh } from '../mesh/mesh';
import { MeshAttribute } from '../mesh/vertex-attribute';
import { applySkinWeights } from './skin-weights-mesh';

describe('applySkinWeights', () => {
  it('inserts JOINTS_0 / WEIGHTS_0 attributes from skin weights', () => {
    const mesh = new Mesh();
    mesh.insertAttribute(MeshAttribute.POSITION, new Float32Array([0, 0, 0, 1, 0, 0]));
    applySkinWeights(mesh, {
      joints: new Uint16Array([0, 1, 0, 0, 1, 0, 0, 0]),
      weights: new Float32Array([0.7, 0.3, 0, 0, 1, 0, 0, 0]),
    });

    const ji = mesh.getAttribute(MeshAttribute.JOINT_INDEX);
    const jw = mesh.getAttribute(MeshAttribute.JOINT_WEIGHT);
    expect(ji?.data).toBeInstanceOf(Uint16Array);
    expect(jw?.data).toBeInstanceOf(Float32Array);
    expect(Array.from((ji!.data as Uint16Array).subarray(0, 2))).toEqual([0, 1]);
    expect((jw!.data as Float32Array)[0]).toBeCloseTo(0.7, 5);
    expect(mesh.hasAttribute(MeshAttribute.JOINT_INDEX)).toBe(true);
  });
});
