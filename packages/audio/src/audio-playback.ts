import type { Entity } from '@retro-engine/ecs';
import type { Handle } from '@retro-engine/engine';

import type { PlayOptions, VoiceId } from './audio-backend';
import type { AudioClip } from './audio-clip';
import type { AudioSource, AudioVoices } from './audio-source';

/**
 * The subset of the `Audio` resource the reconciler needs. Declared structurally
 * so the reconciler is testable with a mock and does not import the concrete
 * `Audio` class.
 */
export interface AudioController {
  play(clip: Handle<AudioClip> | AudioClip, options?: PlayOptions): VoiceId | null;
  stop(voice: VoiceId): void;
  setVolume(voice: VoiceId, volume: number): void;
  isPlaying(voice: VoiceId): boolean;
}

const startVoice = (
  entity: Entity,
  source: AudioSource,
  audio: AudioController,
  voices: AudioVoices,
): void => {
  const existing = voices.get(entity);
  if (existing !== undefined) audio.stop(existing.voice);
  const voice = audio.play(source.clip, {
    volume: source.volume,
    pitch: source.pitch,
    loop: source.loop,
    ...(source.bus !== '' ? { bus: source.bus } : {}),
    ...(source.spatial ? { spatial: true } : {}),
  });
  if (voice !== null) voices.set(entity, { voice, despawnOnEnd: source.despawnOnEnd });
  else voices.delete(entity);
};

const stopVoice = (entity: Entity, audio: AudioController, voices: AudioVoices): void => {
  const existing = voices.get(entity);
  if (existing !== undefined) {
    audio.stop(existing.voice);
    voices.delete(entity);
  }
};

/**
 * Reconcile playing voices against the current {@link AudioSource}s for one
 * frame: honor explicit play/stop requests, auto-start `playOnAdd` sources
 * (retrying until their async clip loads), sync live volume, despawn or drop
 * finished one-shots, and stop voices whose source was removed. Pure over its
 * inputs (no ECS query/command types) so it benches and unit-tests directly;
 * the audio playback system is its only caller in an App.
 *
 * @internal
 */
export const reconcileAudio = (
  sources: Iterable<[Entity, AudioSource]>,
  removed: Iterable<Entity>,
  voices: AudioVoices,
  audio: AudioController,
  despawn: (entity: Entity) => void,
): void => {
  for (const [entity, source] of sources) {
    if (source.stopRequested) {
      stopVoice(entity, audio, voices);
      source.stopRequested = false;
      source.started = true;
    }
    if (source.playRequested) {
      startVoice(entity, source, audio, voices);
      source.playRequested = false;
      source.started = true;
    } else if (source.playOnAdd && !source.started && voices.get(entity) === undefined) {
      startVoice(entity, source, audio, voices);
      // Only mark started once a voice actually took (the clip finished loading);
      // otherwise retry next frame.
      if (voices.get(entity) !== undefined) source.started = true;
    }

    const active = voices.get(entity);
    if (active !== undefined) audio.setVolume(active.voice, source.volume);
  }

  // Finished (non-looping) voices: despawn the entity or just drop the record.
  // Snapshot: the loop deletes from `voices` as it goes.
  for (const [entity, active] of Array.from(voices.entries())) {
    if (!audio.isPlaying(active.voice)) {
      voices.delete(entity);
      if (active.despawnOnEnd) despawn(entity);
    }
  }

  // Sources whose component/entity was removed this frame: stop their voices.
  for (const entity of removed) stopVoice(entity, audio, voices);
};
