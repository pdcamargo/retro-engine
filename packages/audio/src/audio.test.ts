import { describe, expect, it } from 'bun:test';

import type { Handle, LoadContext } from '@retro-engine/engine';

import type { AudioBackend, PlayOptions, VoiceId } from './audio-backend';
import { AudioClip, createAudioClipImporter } from './audio-clip';
import { Audio } from './audio-resource';
import { AudioClips } from './audio-plugin';
import { NullAudioBackend } from './null-audio-backend';
import { WebAudioBackend } from './web-audio-backend';

/** Records what the facade forwards. */
class MockBackend implements AudioBackend {
  readonly playCalls: { clip: AudioClip; options?: PlayOptions }[] = [];
  readonly stopped: VoiceId[] = [];
  master = 1;
  readonly buses = new Map<string, number>();
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
  setBusVolume(bus: string, volume: number): void {
    this.buses.set(bus, volume);
  }
  busVolume(bus: string): number {
    return this.buses.get(bus) ?? 1;
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

  it('round-trips bus volumes (headless parity), defaulting to 1', () => {
    const backend = new NullAudioBackend();
    expect(backend.busVolume('music')).toBe(1); // never-set bus reads unity
    backend.setBusVolume('music', 0.3);
    expect(backend.busVolume('music')).toBe(0.3);
    expect(backend.busVolume('sfx')).toBe(1); // independent per name
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

  it('forwards a bus route on play and bus volume to the backend', () => {
    const backend = new MockBackend();
    const audio = new Audio(backend, new AudioClips());
    audio.play(new AudioClip(new Uint8Array([1])), { bus: 'sfx' });
    expect(backend.playCalls[0]!.options?.bus).toBe('sfx');

    audio.setBusVolume('music', 0.3);
    expect(backend.buses.get('music')).toBe(0.3);
    expect(audio.busVolume('music')).toBe(0.3);
    expect(audio.busVolume('unset')).toBe(1);
  });
});

/** Minimal Web Audio graph stub: records gain nodes and their connections. */
class StubParam {
  constructor(public value = 1) {}
}
class StubGainNode {
  readonly gain = new StubParam(1);
  readonly outputs: object[] = [];
  connect(target: object): void {
    this.outputs.push(target);
  }
  disconnect(): void {
    this.outputs.length = 0;
  }
}
class StubBufferSource {
  buffer: unknown = null;
  loop = false;
  readonly playbackRate = new StubParam(1);
  onended: (() => void) | null = null;
  connect(): void {}
  disconnect(): void {}
  start(): void {}
  stop(): void {}
}
class StubAudioContext {
  state = 'running';
  readonly destination = { id: 'destination' };
  readonly created: StubGainNode[] = [];
  createGain(): StubGainNode {
    const g = new StubGainNode();
    this.created.push(g);
    return g;
  }
  createBufferSource(): StubBufferSource {
    return new StubBufferSource();
  }
  decodeAudioData(): Promise<unknown> {
    return Promise.resolve({});
  }
  resume(): void {}
  close(): void {}
}

describe('WebAudioBackend — mixer buses', () => {
  it('creates a bus gain node wired to master and scales it', () => {
    const ctx = new StubAudioContext();
    const backend = new WebAudioBackend(ctx as unknown as AudioContext);
    const master = ctx.created[0]!; // master gain, built in the constructor
    expect(backend.busVolume('music')).toBe(1); // not created until first use

    backend.setBusVolume('music', 0.4);
    expect(backend.busVolume('music')).toBe(0.4);
    const bus = ctx.created[ctx.created.length - 1]!;
    expect(bus).not.toBe(master);
    expect(bus.gain.value).toBe(0.4);
    expect(bus.outputs).toContain(master); // bus → master
  });

  it('routes a voice through its bus, not straight to master', () => {
    const ctx = new StubAudioContext();
    const backend = new WebAudioBackend(ctx as unknown as AudioContext);
    const master = ctx.created[0]!;
    backend.setBusVolume('sfx', 1); // pre-create so play reuses it
    const busNode = ctx.created[ctx.created.length - 1]!;

    backend.play(new AudioClip(new Uint8Array([1, 2])), { bus: 'sfx' });
    const voiceGain = ctx.created[ctx.created.length - 1]!; // the voice gain play just made
    expect(voiceGain).not.toBe(busNode);
    expect(voiceGain.outputs).toContain(busNode);
    expect(voiceGain.outputs).not.toContain(master);
  });

  it('routes a busless voice straight to master', () => {
    const ctx = new StubAudioContext();
    const backend = new WebAudioBackend(ctx as unknown as AudioContext);
    const master = ctx.created[0]!;
    backend.play(new AudioClip(new Uint8Array([1])));
    const voiceGain = ctx.created[ctx.created.length - 1]!;
    expect(voiceGain.outputs).toContain(master);
  });
});
