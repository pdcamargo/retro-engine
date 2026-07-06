import { describe, expect, it } from 'bun:test';

import type { Handle, LoadContext } from '@retro-engine/engine';

import type { AudioBackend, PlayOptions, VoiceId } from './audio-backend';
import { AudioClip, createAudioClipImporter } from './audio-clip';
import { Audio } from './audio-resource';
import { AudioClips } from './audio-plugin';
import { NullAudioBackend } from './null-audio-backend';

/** Records what the facade forwards. */
class MockBackend implements AudioBackend {
  readonly playCalls: { clip: AudioClip; options?: PlayOptions }[] = [];
  readonly stopped: VoiceId[] = [];
  master = 1;
  private next = 1;

  resume(): void {}
  suspended(): boolean {
    return false;
  }
  play(clip: AudioClip, options?: PlayOptions): VoiceId | null {
    this.playCalls.push(options === undefined ? { clip } : { clip, options });
    const id = this.next as VoiceId;
    this.next += 1;
    return id;
  }
  stop(voice: VoiceId): void {
    this.stopped.push(voice);
  }
  stopAll(): void {}
  setVolume(): void {}
  isPlaying(): boolean {
    return true;
  }
  setMasterVolume(volume: number): void {
    this.master = volume;
  }
  masterVolume(): number {
    return this.master;
  }
  destroy(): void {}
}

const dummyCtx = { path: '', read: async () => new Uint8Array(), addLabeledAsset: () => ({}) as Handle<unknown> } as unknown as LoadContext;

describe('AudioClip + importer', () => {
  it('wraps bytes and copies them defensively', () => {
    const src = new Uint8Array([1, 2, 3, 4]);
    const clip = createAudioClipImporter()(src, dummyCtx) as AudioClip;
    expect(clip).toBeInstanceOf(AudioClip);
    expect(clip.byteLength).toBe(4);
    expect([...clip.bytes]).toEqual([1, 2, 3, 4]);
    // Mutating the source must not affect the clip (defensive copy).
    src[0] = 99;
    expect(clip.bytes[0]).toBe(1);
  });
});

describe('NullAudioBackend', () => {
  it('never plays and reports suspended', () => {
    const backend = new NullAudioBackend();
    expect(backend.play()).toBeNull();
    expect(backend.suspended()).toBe(true);
    expect(backend.isPlaying()).toBe(false);
    backend.setMasterVolume(0.5);
    expect(backend.masterVolume()).toBe(0.5);
  });
});

describe('Audio facade', () => {
  it('plays a clip directly and forwards options', () => {
    const backend = new MockBackend();
    const audio = new Audio(backend, new AudioClips());
    const clip = new AudioClip(new Uint8Array([1]));
    const voice = audio.play(clip, { volume: 0.5, loop: true });
    expect(voice).not.toBeNull();
    expect(backend.playCalls).toHaveLength(1);
    expect(backend.playCalls[0]!.clip).toBe(clip);
    expect(backend.playCalls[0]!.options).toEqual({ volume: 0.5, loop: true });
  });

  it('resolves a handle against the clip store', () => {
    const backend = new MockBackend();
    const clips = new AudioClips();
    const audio = new Audio(backend, clips);
    const clip = new AudioClip(new Uint8Array([7]));
    const handle = clips.add(clip);
    const voice = audio.play(handle);
    expect(voice).not.toBeNull();
    expect(backend.playCalls[0]!.clip).toBe(clip);
  });

  it('returns null for a handle whose clip is not loaded', () => {
    const backend = new MockBackend();
    const clips = new AudioClips();
    const audio = new Audio(backend, clips);
    const handle = clips.reserveHandle();
    expect(audio.play(handle)).toBeNull();
    expect(backend.playCalls).toHaveLength(0);
  });

  it('delegates stop / master volume to the backend', () => {
    const backend = new MockBackend();
    const audio = new Audio(backend, new AudioClips());
    const voice = audio.play(new AudioClip())!;
    audio.stop(voice);
    expect(backend.stopped).toEqual([voice]);
    audio.setMasterVolume(0.25);
    expect(audio.masterVolume()).toBe(0.25);
  });
});
