// Per-frame cost of reconciling AudioSource state into playing voices
// (ADR-0147 Phase 2). Runs every frame in postUpdate; scales with the number of
// audio sources. See ADR-0017.

import { bench, summary } from 'mitata';

import type { Entity } from '@retro-engine/ecs';

import type { PlayOptions, VoiceId } from '../src/audio-backend';
import type { AudioController } from '../src/audio-playback';
import { reconcileAudio } from '../src/audio-playback';
import { AudioSource, AudioVoices } from '../src/audio-source';

// A backend stub that always "plays" and keeps every voice alive (loops).
const controller = (): AudioController => {
  const playing = new Set<VoiceId>();
  let next = 1;
  return {
    play(_clip: unknown, _options?: PlayOptions): VoiceId | null {
      const v = next as VoiceId;
      next += 1;
      playing.add(v);
      return v;
    },
    stop: (v) => void playing.delete(v),
    setVolume: () => {},
    isPlaying: (v) => playing.has(v),
  };
};

const noDespawn = (): void => {};

for (const count of [8, 64, 256]) {
  summary(() => {
    bench(`reconcileAudio @ ${count} sources`, function* () {
      const rows: [Entity, AudioSource][] = Array.from({ length: count }, (_, i) => [
        (i + 1) as Entity,
        new AudioSource(undefined, { loop: true }),
      ]);
      const voices = new AudioVoices();
      const audio = controller();
      // Warm: start every voice so we measure steady-state sync, not first-start.
      reconcileAudio(rows, [], voices, audio, noDespawn);
      yield () => reconcileAudio(rows, [], voices, audio, noDespawn);
    });
  });
}
