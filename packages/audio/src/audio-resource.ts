import type { Assets, Handle } from '@retro-engine/engine';

import { AudioClip } from './audio-clip';
import type { AudioBackend, BusEffect, PlayOptions, VoiceId } from './audio-backend';

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
  /** Bus → its output bus name. Absent (or `''`) means the bus routes to master. */
  private readonly busGraph = new Map<string, string>();
  /** Bus → its current effect insert, for the {@link Audio.busEffect} query. */
  private readonly busEffectMap = new Map<string, BusEffect>();

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

  /** Set a live voice's stereo pan, `[-1, 1]` (no-op for a non-spatial voice). */
  setPan(voice: VoiceId, pan: number): void {
    this.backend.setPan(voice, pan);
  }

  /**
   * Set a live voice's distance-attenuation gain (typically `[0, 1]`), applied
   * independently of its volume (no-op for a non-spatial voice).
   */
  setSpatialGain(voice: VoiceId, gain: number): void {
    this.backend.setSpatialGain(voice, gain);
  }

  /** Set a 3D voice's world position (no-op for a non-3D voice). */
  setSpatialPosition(voice: VoiceId, x: number, y: number, z: number): void {
    this.backend.setSpatialPosition(voice, x, y, z);
  }

  /** Set the listener's world position, shared by every 3D voice. */
  setListenerPosition(x: number, y: number, z: number): void {
    this.backend.setListenerPosition(x, y, z);
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

  /**
   * Set the linear gain of a mixer bus (e.g. `'music'`, `'sfx'`), scaling every
   * voice routed to it. Route a voice to a bus with `play(clip, { bus })` or an
   * {@link AudioSource}'s `bus` field.
   */
  setBusVolume(bus: string, volume: number): void {
    this.backend.setBusVolume(bus, volume);
  }

  /** The current gain of a mixer bus, or `1` for one never set. */
  busVolume(bus: string): number {
    return this.backend.busVolume(bus);
  }

  /**
   * Route `bus`'s output into another bus (a submix, e.g. `dialogue` → `voice`),
   * or back to master when `output` is `''`. Rejects a routing that would form a
   * cycle (throws, leaving the graph unchanged), so submix trees stay acyclic.
   */
  setBusOutput(bus: string, output: string): void {
    if (output !== '' && this.wouldCycle(bus, output)) {
      throw new Error(`Audio.setBusOutput: routing '${bus}' -> '${output}' would form a bus cycle`);
    }
    if (output === '') this.busGraph.delete(bus);
    else this.busGraph.set(bus, output);
    this.backend.configureBus(bus, output);
  }

  /** The bus `bus` routes into, or `''` when it routes to master. */
  busOutput(bus: string): string {
    return this.busGraph.get(bus) ?? '';
  }

  /**
   * Insert an effect on a bus (a filter or compressor, between its gain and its
   * output), or remove it with `null`. See {@link BusEffect}.
   */
  setBusEffect(bus: string, effect: BusEffect | null): void {
    if (effect === null) this.busEffectMap.delete(bus);
    else this.busEffectMap.set(bus, effect);
    this.backend.setBusEffect(bus, effect);
  }

  /** The effect inserted on `bus`, or `null` if none. */
  busEffect(bus: string): BusEffect | null {
    return this.busEffectMap.get(bus) ?? null;
  }

  /** Whether routing `bus` → `output` would close a cycle through the current graph. */
  private wouldCycle(bus: string, output: string): boolean {
    const seen = new Set<string>();
    let cur = output;
    while (cur !== '' && !seen.has(cur)) {
      if (cur === bus) return true;
      seen.add(cur);
      cur = this.busGraph.get(cur) ?? '';
    }
    return false;
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
