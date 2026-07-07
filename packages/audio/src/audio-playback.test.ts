import { describe, expect, it, mock } from 'bun:test';

import type { Entity } from '@retro-engine/ecs';

import type { PlayOptions, VoiceId } from './audio-backend';
import type { AudioController } from './audio-playback';
import { reconcileAudio } from './audio-playback';
import { AudioSource, AudioVoices } from './audio-source';

const e = (n: number): Entity => n as Entity;

class MockAudio implements AudioController {
  readonly played: { options?: PlayOptions }[] = [];
  readonly stopped: VoiceId[] = [];
  readonly volumes: [VoiceId, number][] = [];
  private readonly playing = new Set<VoiceId>();
  private nextId = 1;
  failNextPlay = false;

  play(_clip: unknown, options?: PlayOptions): VoiceId | null {
    this.played.push(options === undefined ? {} : { options });
    if (this.failNextPlay) {
      this.failNextPlay = false;
      return null;
    }
    const voice = this.nextId as VoiceId;
    this.nextId += 1;
    this.playing.add(voice);
    return voice;
  }
  stop(voice: VoiceId): void {
    this.stopped.push(voice);
    this.playing.delete(voice);
  }
  setVolume(voice: VoiceId, volume: number): void {
    this.volumes.push([voice, volume]);
  }
  isPlaying(voice: VoiceId): boolean {
    return this.playing.has(voice);
  }
  /** Simulate a one-shot voice finishing. */
  finish(voice: VoiceId): void {
    this.playing.delete(voice);
  }
}

const noDespawn = (): void => {};

describe('reconcileAudio — playOnAdd', () => {
  it('starts a playOnAdd source once and does not replay', () => {
    const audio = new MockAudio();
    const voices = new AudioVoices();
    const src = new AudioSource(undefined, { loop: true });
    const rows: [Entity, AudioSource][] = [[e(1), src]];

    reconcileAudio(rows, [], voices, audio, noDespawn);
    expect(audio.played).toHaveLength(1);
    expect(voices.size).toBe(1);
    expect(src.started).toBe(true);

    reconcileAudio(rows, [], voices, audio, noDespawn);
    expect(audio.played).toHaveLength(1); // not replayed
  });

  it('retries playOnAdd until the clip loads', () => {
    const audio = new MockAudio();
    const voices = new AudioVoices();
    const src = new AudioSource();
    const rows: [Entity, AudioSource][] = [[e(1), src]];

    audio.failNextPlay = true; // clip not decoded yet
    reconcileAudio(rows, [], voices, audio, noDespawn);
    expect(voices.size).toBe(0);
    expect(src.started).toBe(false);

    reconcileAudio(rows, [], voices, audio, noDespawn);
    expect(voices.size).toBe(1);
    expect(src.started).toBe(true);
  });

  it('does not auto-start when playOnAdd is false', () => {
    const audio = new MockAudio();
    const voices = new AudioVoices();
    const src = new AudioSource(undefined, { playOnAdd: false });
    reconcileAudio([[e(1), src]], [], voices, audio, noDespawn);
    expect(audio.played).toHaveLength(0);
  });
});

describe('reconcileAudio — explicit play / stop', () => {
  it('play() restarts, stopping any existing voice first', () => {
    const audio = new MockAudio();
    const voices = new AudioVoices();
    const src = new AudioSource(undefined, { loop: true });
    const rows: [Entity, AudioSource][] = [[e(1), src]];

    reconcileAudio(rows, [], voices, audio, noDespawn);
    const first = voices.get(e(1))!.voice;

    src.play();
    reconcileAudio(rows, [], voices, audio, noDespawn);
    expect(audio.stopped).toContain(first); // old voice stopped
    expect(voices.get(e(1))!.voice).not.toBe(first);
    expect(src.playRequested).toBe(false);
  });

  it('stop() stops and clears the voice', () => {
    const audio = new MockAudio();
    const voices = new AudioVoices();
    const src = new AudioSource(undefined, { loop: true });
    const rows: [Entity, AudioSource][] = [[e(1), src]];

    reconcileAudio(rows, [], voices, audio, noDespawn);
    const voice = voices.get(e(1))!.voice;
    src.stop();
    reconcileAudio(rows, [], voices, audio, noDespawn);
    expect(audio.stopped).toContain(voice);
    expect(voices.size).toBe(0);
    expect(src.stopRequested).toBe(false);
  });
});

describe('reconcileAudio — volume sync', () => {
  it('applies the source volume to the live voice each frame', () => {
    const audio = new MockAudio();
    const voices = new AudioVoices();
    const src = new AudioSource(undefined, { loop: true, volume: 1 });
    const rows: [Entity, AudioSource][] = [[e(1), src]];
    reconcileAudio(rows, [], voices, audio, noDespawn);
    const voice = voices.get(e(1))!.voice;

    src.volume = 0.25;
    reconcileAudio(rows, [], voices, audio, noDespawn);
    expect(audio.volumes.at(-1)).toEqual([voice, 0.25]);
  });
});

describe('reconcileAudio — finish / removal', () => {
  it('despawns a finished one-shot when despawnOnEnd is set', () => {
    const audio = new MockAudio();
    const voices = new AudioVoices();
    const despawn = mock((_entity: Entity) => {});
    const src = new AudioSource(undefined, { despawnOnEnd: true });
    const rows: [Entity, AudioSource][] = [[e(1), src]];

    reconcileAudio(rows, [], voices, audio, despawn);
    const voice = voices.get(e(1))!.voice;
    audio.finish(voice); // one-shot ends

    reconcileAudio(rows, [], voices, audio, despawn);
    expect(despawn).toHaveBeenCalledTimes(1);
    expect(voices.size).toBe(0);
  });

  it('keeps a looping voice alive (never "finishes")', () => {
    const audio = new MockAudio();
    const voices = new AudioVoices();
    const despawn = mock((_entity: Entity) => {});
    const src = new AudioSource(undefined, { loop: true, despawnOnEnd: true });
    const rows: [Entity, AudioSource][] = [[e(1), src]];
    reconcileAudio(rows, [], voices, audio, despawn);
    reconcileAudio(rows, [], voices, audio, despawn);
    expect(despawn).not.toHaveBeenCalled();
    expect(voices.size).toBe(1);
  });

  it('stops a voice whose source was removed', () => {
    const audio = new MockAudio();
    const voices = new AudioVoices();
    const src = new AudioSource(undefined, { loop: true });
    reconcileAudio([[e(1), src]], [], voices, audio, noDespawn);
    const voice = voices.get(e(1))!.voice;
    // Next frame the source is gone; only its removal id is reported.
    reconcileAudio([], [e(1)], voices, audio, noDespawn);
    expect(audio.stopped).toContain(voice);
    expect(voices.size).toBe(0);
  });
});

describe('reconcileAudio — mixer bus routing', () => {
  it('forwards a source bus in the play options', () => {
    const audio = new MockAudio();
    const voices = new AudioVoices();
    const src = new AudioSource(undefined, { bus: 'music' });
    reconcileAudio([[e(1), src]], [], voices, audio, noDespawn);
    expect(audio.played).toHaveLength(1);
    expect(audio.played[0]!.options?.bus).toBe('music');
  });

  it('omits the bus for a source with no bus (routes to master)', () => {
    const audio = new MockAudio();
    const voices = new AudioVoices();
    const src = new AudioSource(); // default bus ''
    reconcileAudio([[e(1), src]], [], voices, audio, noDespawn);
    expect(audio.played[0]!.options?.bus).toBeUndefined();
  });
});
