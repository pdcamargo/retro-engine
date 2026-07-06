import type { AudioClip } from './audio-clip';

/**
 * Opaque handle to one playing sound instance ("voice"), returned by
 * {@link AudioBackend.play}. Use it to stop or adjust that instance. A one-shot
 * voice becomes invalid once it finishes; a looping voice stays valid until
 * stopped.
 */
export type VoiceId = number & { readonly __brand: 'VoiceId' };

/** Per-play options. All optional; omitted fields use sensible defaults. */
export interface PlayOptions {
  /** Linear gain, `1` = unchanged. Default `1`. */
  readonly volume?: number;
  /** Loop until stopped. Default `false` (one-shot). */
  readonly loop?: boolean;
  /** Playback-rate multiplier (also shifts pitch). `1` = original. Default `1`. */
  readonly pitch?: number;
}

/**
 * The audio hardware-abstraction seam. Decouples playback from the Web Audio
 * API so the engine can run headless (a no-op backend) and, if ever needed, over
 * a non-Web-Audio implementation. The active backend is chosen by
 * `AudioPlugin` and reached through the `Audio` resource.
 */
export interface AudioBackend {
  /**
   * Resume the underlying audio context (browsers start it suspended until a
   * user gesture). Safe to call repeatedly; a no-op backend ignores it.
   */
  resume(): void;
  /** Whether the backend is currently unable to produce sound (context suspended / headless). */
  suspended(): boolean;
  /**
   * Start playing `clip`. Returns a {@link VoiceId} to control the instance, or
   * `null` if playback could not start (headless backend, or a decode failure).
   */
  play(clip: AudioClip, options?: PlayOptions): VoiceId | null;
  /** Stop a playing voice. Unknown or finished ids are ignored. */
  stop(voice: VoiceId): void;
  /** Stop every playing voice. */
  stopAll(): void;
  /** Set a live voice's linear gain. Unknown or finished ids are ignored. */
  setVolume(voice: VoiceId, volume: number): void;
  /** Whether `voice` is still playing. */
  isPlaying(voice: VoiceId): boolean;
  /** Set the master gain applied to every voice, `[0, ∞)` (typically `[0, 1]`). */
  setMasterVolume(volume: number): void;
  /** The current master gain. */
  masterVolume(): number;
  /** Release all resources (stop everything, close the context). */
  destroy(): void;
}
