import type { Entity } from '@retro-engine/ecs';
import type { Handle } from '@retro-engine/engine';
import { asAssetIndex, makeHandle } from '@retro-engine/engine';

import type { VoiceId } from './audio-backend';
import type { AudioClip } from './audio-clip';

/** An empty clip handle — the default until a real one is assigned; never resolves. */
const EMPTY_CLIP: Handle<AudioClip> = makeHandle<AudioClip>(asAssetIndex(0));

/** Options for the {@link AudioSource} constructor. */
export interface AudioSourceOptions {
  readonly volume?: number;
  readonly pitch?: number;
  readonly loop?: boolean;
  readonly playOnAdd?: boolean;
  readonly despawnOnEnd?: boolean;
  readonly bus?: string;
  readonly spatial?: boolean;
  readonly panWidth?: number;
}

/**
 * An entity that emits sound. Attach one with a clip handle; the audio systems
 * start it playing (by default the moment it is added) and stop it when the
 * component or entity is removed. Authored state (serialized): the clip, volume,
 * pitch, loop, and lifecycle flags. Live changes to {@link AudioSource.volume}
 * are applied to the playing voice each frame.
 *
 * @example
 * ```ts
 * cmd.spawn(new AudioSource(musicHandle, { volume: 0.4, loop: true }));
 * // Fire-and-forget SFX entity that cleans itself up:
 * cmd.spawn(new AudioSource(shotHandle, { despawnOnEnd: true }));
 * ```
 */
export class AudioSource {
  /** The clip to play. */
  clip: Handle<AudioClip>;
  /** Linear gain, `1` = unchanged. */
  volume: number;
  /** Playback-rate multiplier (also shifts pitch). `1` = original. */
  pitch: number;
  /** Loop until stopped / removed. */
  loop: boolean;
  /** Start playing automatically the first frame after the component is added. */
  playOnAdd: boolean;
  /** Despawn the entity when a non-looping voice finishes. */
  despawnOnEnd: boolean;
  /**
   * Mixer bus to route this source through (e.g. `'music'`, `'sfx'`). Empty
   * routes straight to master. Set the bus's level with `Audio.setBusVolume`.
   */
  bus: string;
  /**
   * Pan this source in stereo by its world position relative to the
   * {@link AudioListener}. When `false` it plays centered.
   */
  spatial: boolean;
  /**
   * World-space horizontal offset from the listener at which the pan reaches full
   * left/right. Only meaningful when {@link AudioSource.spatial}.
   */
  panWidth: number;

  /** Runtime: set by {@link AudioSource.play} to (re)start on the next frame. Not serialized. */
  playRequested = false;
  /** Runtime: set by {@link AudioSource.stop} to stop on the next frame. Not serialized. */
  stopRequested = false;
  /**
   * Runtime: whether `playOnAdd` has already fired (or an explicit play/stop
   * superseded it). Lets `playOnAdd` retry until the async clip finishes
   * loading, then start exactly once. Not serialized.
   */
  started = false;

  constructor(clip: Handle<AudioClip> = EMPTY_CLIP, options: AudioSourceOptions = {}) {
    this.clip = clip;
    this.volume = options.volume ?? 1;
    this.pitch = options.pitch ?? 1;
    this.loop = options.loop ?? false;
    this.playOnAdd = options.playOnAdd ?? true;
    this.despawnOnEnd = options.despawnOnEnd ?? false;
    this.bus = options.bus ?? '';
    this.spatial = options.spatial ?? false;
    this.panWidth = options.panWidth ?? 10;
  }

  /** Request a (re)start of this source on the next audio update. */
  play(): void {
    this.playRequested = true;
  }

  /** Request this source stop on the next audio update. */
  stop(): void {
    this.stopRequested = true;
  }
}

/**
 * Marks the entity whose position and settings define "the ears." Non-spatial
 * for now: its {@link AudioListener.volume} drives the master gain. Spatial
 * panning off the listener transform arrives with mixer buses (P1).
 */
export class AudioListener {
  /** Master gain applied to all audio, `1` = unchanged. */
  volume: number;

  constructor(volume = 1) {
    this.volume = volume;
  }
}

/** A live voice bound to a source entity. */
interface ActiveVoice {
  readonly voice: VoiceId;
  readonly despawnOnEnd: boolean;
}

/**
 * Runtime map of source entity → its currently playing voice, maintained by the
 * audio playback system. Derived state — never serialized.
 */
export class AudioVoices {
  private readonly map = new Map<Entity, ActiveVoice>();

  get(entity: Entity): ActiveVoice | undefined {
    return this.map.get(entity);
  }

  set(entity: Entity, voice: ActiveVoice): void {
    this.map.set(entity, voice);
  }

  delete(entity: Entity): boolean {
    return this.map.delete(entity);
  }

  entries(): IterableIterator<[Entity, ActiveVoice]> {
    return this.map.entries();
  }

  /** Number of tracked voices. */
  get size(): number {
    return this.map.size;
  }
}
