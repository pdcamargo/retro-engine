import type { App, PluginObject } from '@retro-engine/engine';
import { Assets, AssetServer, registerAssetKind, registerAssetStore } from '@retro-engine/engine';

import type { AudioBackend } from './audio-backend';
import { AUDIO_CLIP_ASSET_KIND, AUDIO_CLIP_EXTENSIONS, AudioClip, createAudioClipImporter } from './audio-clip';
import { Audio } from './audio-resource';
import { NullAudioBackend } from './null-audio-backend';
import { WebAudioBackend } from './web-audio-backend';

/**
 * The loaded {@link AudioClip} store, read via `Res(AudioClips)`. A distinct
 * `Assets` subclass so it is keyed separately in the resource map (as `Meshes`,
 * `AnimationClips`, etc. are).
 */
export class AudioClips extends Assets<AudioClip> {}

/** Whether the Web Audio API is available in this environment. */
const webAudioAvailable = (): boolean => typeof AudioContext !== 'undefined';

/** Options for {@link AudioPlugin}. */
export interface AudioPluginOptions {
  /**
   * Backend to play through. Defaults to a {@link WebAudioBackend} when the Web
   * Audio API is present, otherwise a {@link NullAudioBackend} (so tests and
   * server worlds run unchanged). Pass a mock backend to assert playback in tests.
   */
  readonly backend?: AudioBackend;
}

/**
 * Registers the audio backend, the `Audio` resource, and the {@link AudioClip}
 * asset kind + loader (`.wav` / `.ogg` / `.mp3`). Add it to an `App`, load clips
 * through the `AssetServer`, and play them via `Res(Audio)`.
 *
 * Opt-in (not part of `CorePlugin`) and headless-safe — with no Web Audio it
 * installs a no-op backend. Mirrors `InputPlugin`.
 */
export class AudioPlugin implements PluginObject {
  private readonly backend: AudioBackend;

  constructor(options: AudioPluginOptions = {}) {
    this.backend = options.backend ?? (webAudioAvailable() ? new WebAudioBackend() : new NullAudioBackend());
  }

  name(): string {
    return 'AudioPlugin';
  }

  build(app: App): void {
    if (app.getResource(AudioClips) === undefined) app.insertResource(new AudioClips());
    const clips = app.getResource(AudioClips)!;
    app.insertResource(new Audio(this.backend, clips));

    registerAssetStore(app, AUDIO_CLIP_ASSET_KIND, clips);
    registerAssetKind(app, {
      kind: AUDIO_CLIP_ASSET_KIND,
      extensions: [...AUDIO_CLIP_EXTENSIONS],
      discoverable: true,
      largeBinary: true,
      category: 'audio',
    });

    // Register loaders once the AssetServer exists (order-independent via
    // whenResource): by extension for loose files, and by kind for GUID loads.
    app.whenResource(AssetServer, (server) => {
      const importer = createAudioClipImporter();
      for (const ext of AUDIO_CLIP_EXTENSIONS) server.registerLoader(ext, clips, importer);
      server.registerLoaderByKind(AUDIO_CLIP_ASSET_KIND, clips, importer);
    });
  }

  /** The active audio backend, for teardown or advanced use. */
  getBackend(): AudioBackend {
    return this.backend;
  }
}
