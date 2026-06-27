import { Transform } from '@retro-engine/engine';
import { vec3 } from '@retro-engine/math';
import { describe, expect, it } from 'bun:test';

import type { Gltf, GltfNode } from './gltf-root';
import { buildHumanoidRetargetRigFromGltf } from './retarget-rig-from-gltf';

interface NodeSpec {
  readonly name?: string;
  readonly t?: readonly [number, number, number];
  readonly children?: readonly number[];
}

/** Build a minimal {@link Gltf} from node specs and the default scene's root nodes. */
const makeGltf = (nodes: readonly NodeSpec[], roots: readonly number[]): Gltf => {
  const scene = { nodes: roots };
  return {
    scenes: [scene],
    namedScenes: new Map(),
    defaultScene: scene,
    meshes: [],
    namedMeshes: new Map(),
    materials: [],
    namedMaterials: new Map(),
    images: [],
    nodes: nodes.map((n): GltfNode => {
      const [x, y, z] = n.t ?? [0, 0, 0];
      const transform = new Transform(vec3.create(x, y, z));
      const children = n.children ?? [];
      return n.name !== undefined ? { transform, children, name: n.name } : { transform, children };
    }),
    namedNodes: new Map(),
    skins: [],
    animationClips: [],
  };
};

// A tiny humanoid: Hips → Spine → Head, with one leg chain so multiple slots map.
const humanoid = (): Gltf =>
  makeGltf(
    [
      { name: 'Hips', t: [0, 1, 0], children: [1, 3] }, // 0
      { name: 'Spine', t: [0, 0.4, 0], children: [2] }, // 1
      { name: 'Head', t: [0, 0.3, 0] }, // 2
      { name: 'LeftUpLeg', t: [0.1, -0.1, 0], children: [4] }, // 3
      { name: 'LeftLeg', t: [0, -0.5, 0] }, // 4
    ],
    [0],
  );

describe('buildHumanoidRetargetRigFromGltf', () => {
  it('maps humanoid bones by name with node-index bone ids', () => {
    const rig = buildHumanoidRetargetRigFromGltf(humanoid());

    expect(rig.slot('Hips')).toBeDefined();
    expect(rig.slot('Hips')!.boneId).toBe('0');
    expect(rig.slotByBoneId.get('1')).toBe('Spine');
    expect(rig.slotByBoneId.get('2')).toBe('Head');
    expect(rig.slot('LeftUpperLeg')!.boneId).toBe('3');
    expect(rig.slot('LeftLowerLeg')!.boneId).toBe('4');
  });

  it('captures local rest transforms and FK-accumulated world translation', () => {
    const rig = buildHumanoidRetargetRigFromGltf(humanoid());

    // Local translation is the node's own.
    const spineT = rig.slot('Spine')!.restT;
    expect(spineT[0]).toBeCloseTo(0, 5);
    expect(spineT[1]).toBeCloseTo(0.4, 5);
    expect(spineT[2]).toBeCloseTo(0, 5);

    // World translation accumulates down the chain: Hips(0,1,0) → Spine(0,1.4,0)
    // → Head(0,1.7,0).
    const head = rig.slot('Head')!.restWorldT;
    expect(head[0]).toBeCloseTo(0, 5);
    expect(head[1]).toBeCloseTo(1.7, 5);
    expect(head[2]).toBeCloseTo(0, 5);
  });

  it('skips a document with no recognizable humanoid bones', () => {
    const rig = buildHumanoidRetargetRigFromGltf(
      makeGltf([{ name: 'prop', t: [0, 0, 0] }], [0]),
    );
    expect(rig.slots.length).toBe(0);
    expect(rig.slot('Hips')).toBeUndefined();
  });
});
