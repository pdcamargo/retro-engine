import type { Entity } from '@retro-engine/ecs';
import type { Handle } from '@retro-engine/engine';
import { asAssetIndex, makeHandle } from '@retro-engine/engine';

import type { VoiceId } from './audio-backend';
import type { AudioClip } from './audio-clip';
import type { DistanceModel } from './spatial';

/**
 * How a spatial source is spatialized:
 * - `'2d'` — stereo pan by horizontal offset + a distance-attenuation gain (the
 *   default; cheap, right for 2D games).
 * - `'3d'` — a Web Audio `PannerNode` positioned in 3D relative to the listener
 *   (elevation, front/back, HRTF). Uses the same `refDistance`/`maxDistance`/
 *   `rolloff`/`distanceModel` for its internal falloff.
 */
export type SpatialMode = '2d' | '3d';

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
  readonly refDistance?: number;
  readonly maxDistance?: number;
  readonly rolloff?: number;
  readonly distanceModel?: DistanceModel;
  readonly spatialMode?: SpatialMode;
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
  /**
   * Distance (world units) within which a spatial source plays at full volume;
   * attenuation begins beyond it. Only meaningful when {@link AudioSource.spatial}.
   */
  refDistance: number;
  /**
   * Distance (world units) at which a spatial source reaches its quietest; it does
   * not fade further past this. Only meaningful when {@link AudioSource.spatial}.
   */
  maxDistance: number;
  /**
   * How steeply a spatial source fades with distance. `0` disables distance
   * attenuation (pan-only). For the linear model, `1` fades to silence at
   * `maxDistance`. Only meaningful when {@link AudioSource.spatial}.
   */
  rolloff: number;
  /**
   * Which distance-falloff curve to use (`'linear'` / `'inverse'` /
   * `'exponential'`, matching Web Audio). Default `'linear'`. `'inverse'` /
   * `'exponential'` ignore `maxDistance`. Only meaningful when
   * {@link AudioSource.spatial}.
   */
  distanceModel: DistanceModel;
  /**
   * `'2d'` stereo pan + attenuation (default) or `'3d'` full positional audio via
   * a Web Audio `PannerNode` (elevation / front-back / HRTF). Only meaningful when
   * {@link AudioSource.spatial}.
   */
  spatialMode: SpatialMode;

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
    this.refDistance = options.refDistance ?? 1;
    this.maxDistance = options.maxDistance ?? 100;
    this.rolloff = options.rolloff ?? 1;
    this.distanceModel = options.distanceModel ?? 'linear';
    this.spatialMode = options.spatialMode ?? '2d';
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
