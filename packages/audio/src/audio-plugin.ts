import type { App, PluginObject } from '@retro-engine/engine';
import {
  Assets,
  AssetServer,
  Commands,
  GlobalTransform,
  Query,
  RemovedComponents,
  Res,
  ResMut,
  registerAssetKind,
  registerAssetStore,
} from '@retro-engine/engine';
import { t } from '@retro-engine/reflect';

import type { AudioBackend } from './audio-backend';
import { AUDIO_CLIP_ASSET_KIND, AUDIO_CLIP_EXTENSIONS, AudioClip, createAudioClipImporter } from './audio-clip';
import { reconcileAudio } from './audio-playback';
import { Audio } from './audio-resource';
import { AudioListener, AudioSource, AudioVoices } from './audio-source';
import { NullAudioBackend } from './null-audio-backend';
import { attenuationForDistance, panForOffset } from './spatial';
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

    // ECS-driven playback (ADR-0147 Phase 2).
    app.insertResource(new AudioVoices());
    app.registerComponent(
      AudioSource,
      {
        clip: t.handle(AUDIO_CLIP_ASSET_KIND),
        volume: t.number,
        pitch: t.number,
        loop: t.boolean,
        playOnAdd: t.boolean,
        despawnOnEnd: t.boolean,
        bus: t.string,
        spatial: t.boolean,
        panWidth: t.number,
        refDistance: t.number,
        maxDistance: t.number,
        rolloff: t.number,
        distanceModel: t.enum('linear', 'inverse', 'exponential'),
        playRequested: t.boolean.skip(),
        stopRequested: t.boolean.skip(),
        started: t.boolean.skip(),
      },
      { name: 'AudioSource', make: () => new AudioSource() },
    );
    app.registerComponent(
      AudioListener,
      { volume: t.number },
      { name: 'AudioListener', make: () => new AudioListener() },
    );

    // The (first) listener's volume drives the master gain; runs before playback
    // so voices started this frame see the current master.
    app.addSystem(
      'postUpdate',
      [Query([AudioListener]), ResMut(Audio)],
      (listeners, audio) => {
        for (const [listener] of listeners) {
          audio.setMasterVolume(listener.volume);
          break;
        }
      },
      { name: 'audio-listener', label: 'audio' },
    );

    // Start/stop/sync voices from AudioSource state each frame.
    app.addSystem(
      'postUpdate',
      [Query([AudioSource]), RemovedComponents(AudioSource), ResMut(AudioVoices), ResMut(Audio), Commands],
      (sources, removed, voices, audio, cmd) => {
        reconcileAudio(sources.entries(), removed, voices, audio, (entity) => cmd.despawn(entity));
      },
      { name: 'audio-playback', after: ['audio'] },
    );

    // Stereo-pan + distance-attenuate spatial sources by their world position
    // relative to the first AudioListener that has a transform. Uses the current
    // GlobalTransform (a frame of latency is inaudible); runs after playback so
    // voices exist.
    app.addSystem(
      'postUpdate',
      [Query([AudioSource, GlobalTransform]), Query([AudioListener, GlobalTransform]), Res(AudioVoices), ResMut(Audio)],
      (sources, listeners, voices, audio) => {
        let lx = 0;
        let ly = 0;
        let lz = 0;
        let hasListener = false;
        for (const [, transform] of listeners as Iterable<readonly [AudioListener, GlobalTransform]>) {
          lx = transform.matrix[12] ?? 0;
          ly = transform.matrix[13] ?? 0;
          lz = transform.matrix[14] ?? 0;
          hasListener = true;
          break;
        }
        if (!hasListener) return;
        for (const row of (sources as { entries(): Iterable<readonly unknown[]> }).entries()) {
          const source = row[1] as AudioSource;
          if (!source.spatial) continue;
          const active = (voices as AudioVoices).get(row[0] as never);
          if (active === undefined) continue;
          const m = (row[2] as GlobalTransform).matrix;
          const sx = m[12] ?? 0;
          const distance = Math.hypot(sx - lx, (m[13] ?? 0) - ly, (m[14] ?? 0) - lz);
          (audio as Audio).setPan(active.voice, panForOffset(sx, lx, source.panWidth));
          (audio as Audio).setSpatialGain(
            active.voice,
            attenuationForDistance(distance, source.refDistance, source.maxDistance, source.rolloff, source.distanceModel),
          );
        }
      },
      { name: 'audio-spatial', after: ['audio-playback'] },
    );
  }

  /** The active audio backend, for teardown or advanced use. */
  getBackend(): AudioBackend {
    return this.backend;
  }
}
