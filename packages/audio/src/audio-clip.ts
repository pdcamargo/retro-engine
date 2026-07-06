import type { AssetImporter } from '@retro-engine/engine';

/** The asset-kind key for {@link AudioClip} (`.wav` / `.ogg` / `.mp3`). */
export const AUDIO_CLIP_ASSET_KIND = 'audio';

/** File extensions the {@link AudioClip} loader claims. */
export const AUDIO_CLIP_EXTENSIONS = ['wav', 'ogg', 'mp3'] as const;

/**
 * A loaded sound asset. Holds the **encoded** source bytes (the raw
 * `.wav`/`.ogg`/`.mp3` file); decoding into a playable buffer is the audio
 * backend's job, done lazily on first play and cached. Keeping the asset
 * encoded means it loads with no `AudioContext`, so headless worlds and the
 * asset pipeline are unaffected by whether audio can actually play.
 */
export class AudioClip {
  /** The encoded audio file bytes. */
  readonly bytes: Uint8Array;

  constructor(bytes: Uint8Array = new Uint8Array(0)) {
    this.bytes = bytes;
  }

  /** Size of the encoded data in bytes. */
  get byteLength(): number {
    return this.bytes.length;
  }
}

/**
 * Importer for {@link AudioClip}: wraps the raw file bytes with no decoding
 * (decoding happens in the backend, which owns the `AudioContext`). A defensive
 * copy is taken so the clip owns its buffer independently of the loader's.
 */
export const createAudioClipImporter =
  (): AssetImporter<AudioClip> =>
  (bytes: Uint8Array): AudioClip =>
    new AudioClip(bytes.slice());
