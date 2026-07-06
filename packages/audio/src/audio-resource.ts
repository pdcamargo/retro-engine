import type { Assets, Handle } from '@retro-engine/engine';

import { AudioClip } from './audio-clip';
import type { AudioBackend, PlayOptions, VoiceId } from './audio-backend';

/**
 * The ECS-facing audio facade, read via `Res(Audio)` / `ResMut(Audio)`. Wraps
 * the active {@link AudioBackend} and resolves asset handles against the loaded
 * {@link AudioClip} store, so game code plays a clip by handle without touching
 * Web Audio directly.
 *
 * @example
 * ```ts
 * const shot = assetServer.load<AudioClip>('sfx/shot.wav');
 * app.addSystem('update', [ResMut(Audio)], (audio) => {
 *   if (fire) audio.play(shot, { volume: 0.8 });
 * });
 * ```
 */
export class Audio {
  constructor(
    private readonly backend: AudioBackend,
    private readonly clips: Assets<AudioClip>,
  ) {}

  /**
   * Play a clip, by asset handle or directly. Returns a {@link VoiceId} to
   * control the instance, or `null` if it could not start — the handle's clip is
   * not loaded yet, or the backend is headless.
   */
  play(clip: Handle<AudioClip> | AudioClip, options?: PlayOptions): VoiceId | null {
    const resolved = clip instanceof AudioClip ? clip : this.clips.get(clip);
    if (resolved === undefined) return null;
    return this.backend.play(resolved, options);
  }

  /** Stop a playing voice. */
  stop(voice: VoiceId): void {
    this.backend.stop(voice);
  }

  /** Stop every playing voice. */
  stopAll(): void {
    this.backend.stopAll();
  }

  /** Set a live voice's linear gain. */
  setVolume(voice: VoiceId, volume: number): void {
    this.backend.setVolume(voice, volume);
  }

  /** Whether `voice` is still playing. */
  isPlaying(voice: VoiceId): boolean {
    return this.backend.isPlaying(voice);
  }

  /** Set the master gain applied to all audio. */
  setMasterVolume(volume: number): void {
    this.backend.setMasterVolume(volume);
  }

  /** The current master gain. */
  masterVolume(): number {
    return this.backend.masterVolume();
  }

  /** Resume the audio context (browsers start suspended until a user gesture). */
  resume(): void {
    this.backend.resume();
  }

  /** Whether audio is currently unable to play (context suspended / headless). */
  suspended(): boolean {
    return this.backend.suspended();
  }

  /** The active backend, for advanced use. */
  get backendRef(): AudioBackend {
    return this.backend;
  }
}
