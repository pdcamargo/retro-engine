import type { AssetImporter, AssetSerializer } from '@retro-engine/assets';
import { Assets } from '@retro-engine/assets';
import type { FieldPath } from '@retro-engine/reflect';

import { AnimationClip, type AnimationTrack, type Interpolation } from './animation-clip';

/** The {@link Assets} store holding imported/authored {@link AnimationClip}s. */
export class AnimationClips extends Assets<AnimationClip> {}

/** Asset-kind tag and file extension for {@link AnimationClip}. */
export const ANIMATION_CLIP_ASSET_KIND = 'AnimationClip';

/** Current `.ranim` wire-format version. Bumped only on a breaking shape change. */
export const ANIMATION_CLIP_FORMAT_VERSION = 1;

interface SerializedSampler {
  readonly times: readonly number[];
  readonly values: readonly number[];
  readonly componentCount: number;
  readonly interpolation: Interpolation;
}

interface SerializedTrack {
  readonly targetId: string;
  readonly component: string;
  readonly path: FieldPath;
  readonly sampler: SerializedSampler;
}

interface AnimationClipFile {
  readonly version: number;
  readonly name?: string;
  readonly duration: number;
  readonly tracks: readonly SerializedTrack[];
}

const encodeClip = (clip: AnimationClip): Uint8Array => {
  const file: AnimationClipFile = {
    version: ANIMATION_CLIP_FORMAT_VERSION,
    ...(clip.name !== undefined ? { name: clip.name } : {}),
    duration: clip.duration,
    tracks: clip.tracks.map((track) => ({
      targetId: track.target.targetId,
      component: track.target.component,
      path: track.target.path,
      sampler: {
        times: Array.from(track.sampler.times),
        values: Array.from(track.sampler.values),
        componentCount: track.sampler.componentCount,
        interpolation: track.sampler.interpolation,
      },
    })),
  };
  return new TextEncoder().encode(JSON.stringify(file));
};

const decodeClip = (bytes: Uint8Array): AnimationClip => {
  const raw = JSON.parse(new TextDecoder().decode(bytes)) as Partial<AnimationClipFile>;
  if (raw.version !== ANIMATION_CLIP_FORMAT_VERSION) {
    throw new Error(
      `AnimationClip: unsupported format version ${String(raw.version)} (expected ${ANIMATION_CLIP_FORMAT_VERSION})`,
    );
  }
  if (!Array.isArray(raw.tracks)) {
    throw new Error('AnimationClip: payload is missing a tracks array');
  }
  const tracks: AnimationTrack[] = raw.tracks.map((track) => ({
    target: { targetId: track.targetId, component: track.component, path: track.path },
    sampler: {
      times: new Float32Array(track.sampler.times),
      values: new Float32Array(track.sampler.values),
      componentCount: track.sampler.componentCount,
      interpolation: track.sampler.interpolation,
    },
  }));
  return new AnimationClip(tracks, raw.duration ?? 0, raw.name);
};

/**
 * Build the {@link AssetImporter} that turns `.ranim` bytes (UTF-8 JSON) into an
 * {@link AnimationClip}. Synchronous — a clip is self-contained, with no external
 * buffers to resolve.
 */
export const createAnimationClipImporter = (): AssetImporter<AnimationClip> => (bytes) =>
  decodeClip(bytes);

/**
 * Build the {@link AssetSerializer} that round-trips an {@link AnimationClip}
 * through its canonical `.ranim` JSON form — the inverse of
 * {@link createAnimationClipImporter}.
 */
export const createAnimationClipSerializer = (): AssetSerializer<AnimationClip> => ({
  serialize: (clip) => encodeClip(clip),
  deserialize: (bytes) => decodeClip(bytes),
});
