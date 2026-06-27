import { AnimationClips } from '@retro-engine/engine';
import { describe, expect, it } from 'bun:test';

import { gltfNodeTargetId, mapAnimations } from './animation-mapping';
import { fakeLoadContext, rawBytes } from './mapping-test-support';
import type { GltfDocument } from './schema';

const r45 = Math.SQRT1_2;

/**
 * A document with one animation: a LINEAR translation channel on node 0, a
 * LINEAR rotation channel on node 0, and a `weights` (morph) channel on node 1
 * with two targets. All share a 2-keyframe timeline `[0, 1]`.
 */
const animatedDoc = (): { document: GltfDocument; buffers: Uint8Array[] } => {
  const data = new Float32Array([
    // times (SCALAR ×2)
    0, 1,
    // translation (VEC3 ×2)
    0, 0, 0, 10, 0, 0,
    // rotation (VEC4 ×2): identity, then 90° about Y
    0, 0, 0, 1, 0, r45, 0, r45,
    // weights (SCALAR ×4): 2 targets × 2 keyframes — [0,0] then [1,0.5]
    0, 0, 1, 0.5,
  ]);
  const buffers = [rawBytes(data)];
  const document: GltfDocument = {
    asset: { version: '2.0' },
    nodes: [{ name: 'bone' }, { name: 'morphy' }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 2, type: 'SCALAR' },
      { bufferView: 1, componentType: 5126, count: 2, type: 'VEC3' },
      { bufferView: 2, componentType: 5126, count: 2, type: 'VEC4' },
      { bufferView: 3, componentType: 5126, count: 4, type: 'SCALAR' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 8 },
      { buffer: 0, byteOffset: 8, byteLength: 24 },
      { buffer: 0, byteOffset: 32, byteLength: 32 },
      { buffer: 0, byteOffset: 64, byteLength: 16 },
    ],
    buffers: [{ byteLength: 80 }],
    animations: [
      {
        name: 'Wiggle',
        samplers: [
          { input: 0, output: 1, interpolation: 'LINEAR' },
          { input: 0, output: 2, interpolation: 'LINEAR' },
          { input: 0, output: 3, interpolation: 'LINEAR' },
        ],
        channels: [
          { sampler: 0, target: { node: 0, path: 'translation' } },
          { sampler: 1, target: { node: 0, path: 'rotation' } },
          { sampler: 2, target: { node: 1, path: 'weights' } },
        ],
      },
    ],
  };
  return { document, buffers };
};

describe('mapAnimations', () => {
  it('builds one clip per animation, including a morph-weight track', () => {
    const { document, buffers } = animatedDoc();
    const store = new AnimationClips();
    const { ctx, labels } = fakeLoadContext();

    const handles = mapAnimations(document, buffers, ctx, store);

    expect(handles.length).toBe(1);
    expect(labels).toEqual(['Animation0']);

    const clip = store.get(handles[0]!)!;
    expect(clip.name).toBe('Wiggle');
    expect(clip.duration).toBe(1);
    // translation + rotation + weights tracks.
    expect(clip.tracks.length).toBe(3);

    const translation = clip.tracks[0]!;
    expect(translation.target).toEqual({
      targetId: gltfNodeTargetId(0),
      component: 'Transform',
      path: [{ kind: 'field', name: 'translation' }],
    });
    expect(translation.sampler.componentCount).toBe(3);
    expect(translation.sampler.interpolation).toBe('LINEAR');
    expect(Array.from(translation.sampler.times)).toEqual([0, 1]);
    expect(Array.from(translation.sampler.values)).toEqual([0, 0, 0, 10, 0, 0]);

    const rotation = clip.tracks[1]!;
    expect(rotation.target.path).toEqual([{ kind: 'field', name: 'rotation' }]);
    expect(rotation.sampler.componentCount).toBe(4);

    const weights = clip.tracks[2]!;
    expect(weights.target).toEqual({
      targetId: gltfNodeTargetId(1),
      component: 'MorphWeights',
      path: [{ kind: 'field', name: 'weights' }],
    });
    // 2 targets → per-keyframe component stride of 2.
    expect(weights.sampler.componentCount).toBe(2);
    expect(Array.from(weights.sampler.values)).toEqual([0, 0, 1, 0.5]);
  });

  it('returns no clips for a document without animations', () => {
    const store = new AnimationClips();
    const { ctx } = fakeLoadContext();
    expect(mapAnimations({ asset: { version: '2.0' } }, [], ctx, store)).toEqual([]);
  });
});
