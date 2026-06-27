import type { AnimationClip as AnimationClipType, Assets, Handle, LoadContext } from '@retro-engine/engine';
import { AnimationClip, clipDuration } from '@retro-engine/engine';
import type { AnimationTrack, Interpolation, TrackTarget } from '@retro-engine/engine';
import type { FieldPath } from '@retro-engine/reflect';

import { decodeAccessor } from './accessor';
import type { GltfAnimationChannelTarget, GltfDocument } from './schema';

/**
 * The stable id a glTF node carries as an `AnimationTarget`, and that animation
 * tracks address. The node's document index is used (stable within a document
 * and unique, unlike node names) so a clip's tracks resolve to the spawned bone
 * regardless of naming. Both the importer (building clips) and instantiation
 * (tagging entities) call this, so the two always agree.
 */
export const gltfNodeTargetId = (nodeIndex: number): string => String(nodeIndex);

/** Reflected `Transform` field path for a TRS channel, or `undefined` for an unsupported path. */
const transformPathFor = (path: GltfAnimationChannelTarget['path']): FieldPath | undefined => {
  switch (path) {
    case 'translation':
      return [{ kind: 'field', name: 'translation' }];
    case 'rotation':
      return [{ kind: 'field', name: 'rotation' }];
    case 'scale':
      return [{ kind: 'field', name: 'scale' }];
    default:
      return undefined; // `weights` (morph targets) — see mapAnimations.
  }
};

const asFloat32 = (array: ArrayLike<number>): Float32Array =>
  array instanceof Float32Array ? array : new Float32Array(array);

/**
 * Map a glTF document's `animations` into engine {@link AnimationClip}s, one per
 * glTF animation, registering each as a labeled sub-asset (`Animation{i}`)
 * through {@link LoadContext.addLabeledAsset}. Each channel becomes a track
 * targeting the node's `Transform` (translation/rotation/scale); the clip format
 * itself stays general — only this glTF mapping is TRS-shaped.
 *
 * Morph-target (`weights`) channels become a track on the node's `MorphWeights`
 * component, driving the whole weights array (one keyframe value per target).
 * The output accessor is a flat `SCALAR` stream of `keyframes × targetCount`
 * (`× 3` for `CUBICSPLINE`), so the per-keyframe component count is derived from
 * the input/output lengths.
 */
export const mapAnimations = (
  document: GltfDocument,
  buffers: readonly Uint8Array[],
  ctx: LoadContext,
  store: Assets<AnimationClipType>,
): Handle<AnimationClipType>[] => {
  const handles: Handle<AnimationClipType>[] = [];
  const animations = document.animations ?? [];

  for (let i = 0; i < animations.length; i++) {
    const animation = animations[i]!;
    const tracks: AnimationTrack[] = [];

    for (const channel of animation.channels) {
      const node = channel.target.node;
      if (node === undefined) continue;
      const isWeights = channel.target.path === 'weights';
      const path = isWeights
        ? [{ kind: 'field', name: 'weights' } as const]
        : transformPathFor(channel.target.path);
      if (path === undefined) continue;

      const sampler = animation.samplers[channel.sampler];
      if (sampler === undefined) continue;

      const input = decodeAccessor(document, buffers, sampler.input);
      const output = decodeAccessor(document, buffers, sampler.output);
      const interpolation: Interpolation = sampler.interpolation ?? 'LINEAR';

      // For weights the output is one scalar per (keyframe × target); the target
      // count is the per-keyframe component stride (CUBICSPLINE packs 3× — in
      // tangent, value, out tangent — per element).
      const componentCount = isWeights
        ? Math.max(1, Math.floor(output.count / Math.max(1, input.count) / (interpolation === 'CUBICSPLINE' ? 3 : 1)))
        : output.componentCount;

      const target: TrackTarget = {
        targetId: gltfNodeTargetId(node),
        component: isWeights ? 'MorphWeights' : 'Transform',
        path: path as FieldPath,
      };
      tracks.push({
        target,
        sampler: {
          times: asFloat32(input.array),
          values: asFloat32(output.array),
          componentCount,
          interpolation,
        },
      });
    }

    const clip = new AnimationClip(tracks, clipDuration(tracks), animation.name);
    handles.push(ctx.addLabeledAsset(`Animation${i}`, clip, store));
  }

  return handles;
};
