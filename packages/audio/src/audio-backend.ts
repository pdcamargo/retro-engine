import type { AudioClip } from './audio-clip';
import type { DistanceModel } from './spatial';

/**
 * Configuration for a **3D** spatial voice, driven by a Web Audio `PannerNode`
 * which computes panning *and* distance attenuation internally from the voice's
 * position relative to the listener. `panningModel` picks the spatialization
 * algorithm (`'HRTF'` = binaural/realistic, `'equalpower'` = cheap); `distanceModel`
 * + `refDistance` / `maxDistance` / `rolloff` are the same falloff parameters as
 * the 2D path (see the `spatial` distance fields), applied by the panner.
 */
export interface PannerConfig {
  readonly panningModel: 'HRTF' | 'equalpower';
  readonly distanceModel: DistanceModel;
  readonly refDistance: number;
  readonly maxDistance: number;
  readonly rolloff: number;
}

/**
 * A described effect insert on a mixer bus, applied between the bus's gain and
 * its output. Serializable by shape (no live audio nodes), so a backend builds
 * the concrete node and a headless backend ignores it.
 *
 * - `filter` — a biquad filter (low/high/band-pass) at `frequency` Hz with an
 *   optional resonance `q`. The staple "muffle everything on this bus" effect.
 * - `compressor` — a dynamics compressor; all fields optional (Web Audio
 *   defaults apply). Tames peaks / glues a submix.
 */
export type BusEffect =
  | {
      readonly kind: 'filter';
      readonly type: 'lowpass' | 'highpass' | 'bandpass';
      readonly frequency: number;
      readonly q?: number;
    }
  | {
      readonly kind: 'compressor';
      readonly threshold?: number;
      readonly knee?: number;
      readonly ratio?: number;
      readonly attack?: number;
      readonly release?: number;
    };

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
  /**
   * Mixer bus to route this voice through (e.g. `'music'`, `'sfx'`). Omitted
   * routes straight to master. Per-voice, bus, and master gain multiply. The
   * bus is created on first use; names are free-form conventions, not a fixed set.
   */
  readonly bus?: string;
  /**
   * Give this voice a stereo panner so its left/right position can be driven with
   * {@link AudioBackend.setPan} (a 2D spatial `AudioSource`). Omitted plays
   * centered with no panner. Default `false`.
   */
  readonly spatial?: boolean;
  /**
   * Give this voice a **3D** `PannerNode` instead of the 2D stereo path, driven by
   * {@link AudioBackend.setSpatialPosition} + {@link AudioBackend.setListenerPosition}.
   * The panner does panning + distance attenuation itself, so this is mutually
   * exclusive with {@link PlayOptions.spatial}. Omitted → not a 3D voice.
   */
  readonly panner?: PannerConfig;
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
  /**
   * Set a live voice's stereo pan, `[-1, 1]` (left..right). No-op for a voice
   * that was not started with `spatial: true` (it has no panner), or an unknown
   * id.
   */
  setPan(voice: VoiceId, pan: number): void;
  /**
   * Set a live voice's distance-attenuation gain, `[0, ∞)` (typically `[0, 1]`),
   * applied independently of its {@link AudioBackend.setVolume} gain. No-op for a
   * voice that was not started with `spatial: true`, or an unknown id.
   */
  setSpatialGain(voice: VoiceId, gain: number): void;
  /**
   * Set a **3D** voice's world position (the panner computes pan + distance
   * attenuation from it relative to the listener). No-op for a voice not started
   * with a {@link PlayOptions.panner}, or an unknown id.
   */
  setSpatialPosition(voice: VoiceId, x: number, y: number, z: number): void;
  /** Set the listener's world position, shared by every 3D voice. */
  setListenerPosition(x: number, y: number, z: number): void;
  /** Whether `voice` is still playing. */
  isPlaying(voice: VoiceId): boolean;
  /** Set the master gain applied to every voice, `[0, ∞)` (typically `[0, 1]`). */
  setMasterVolume(volume: number): void;
  /** The current master gain. */
  masterVolume(): number;
  /**
   * Set the linear gain of a mixer bus, scaling every voice routed to it via
   * {@link PlayOptions.bus}. Creates the bus if it does not exist yet.
   */
  setBusVolume(bus: string, volume: number): void;
  /** The current gain of a mixer bus, or `1` for a bus that has never been set. */
  busVolume(bus: string): number;
  /**
   * Route a bus's output to another bus (a submix), or to master when `output`
   * is `''`. Both buses are created if needed. This is the mechanical reconnect
   * only — callers route through the `Audio` resource, which owns the bus graph
   * and rejects cycles.
   */
  configureBus(bus: string, output: string): void;
  /**
   * Insert `effect` on a bus (between its gain and its output), or remove any
   * effect when `null`. Composes with {@link AudioBackend.configureBus} routing.
   * A headless backend ignores it.
   */
  setBusEffect(bus: string, effect: BusEffect | null): void;
  /** Release all resources (stop everything, close the context). */
  destroy(): void;
}
