import { describe, expect, it } from 'bun:test';

import type { Handle, LoadContext } from '@retro-engine/engine';

import type { AudioBackend, BusEffect, PlayOptions, VoiceId } from './audio-backend';
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
  readonly pans: [VoiceId, number][] = [];
  setPan(voice: VoiceId, pan: number): void {
    this.pans.push([voice, pan]);
  }
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
  readonly busRoutes: [string, string][] = [];
  configureBus(bus: string, output: string): void {
    this.busRoutes.push([bus, output]);
  }
  readonly busEffects: [string, BusEffect | null][] = [];
  setBusEffect(bus: string, effect: BusEffect | null): void {
    this.busEffects.push([bus, effect]);
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

  it('routes a bus into a submix and back to master, rejecting cycles', () => {
    const backend = new MockBackend();
    const audio = new Audio(backend, new AudioClips());

    audio.setBusOutput('dialogue', 'voice');
    expect(audio.busOutput('dialogue')).toBe('voice');
    expect(backend.busRoutes).toContainEqual(['dialogue', 'voice']);

    // voice → master is fine; dialogue → voice → master is an acyclic tree.
    audio.setBusOutput('voice', '');
    expect(audio.busOutput('voice')).toBe('');

    // voice → dialogue would close dialogue → voice → dialogue: rejected.
    expect(() => audio.setBusOutput('voice', 'dialogue')).toThrow(/cycle/);
    expect(audio.busOutput('voice')).toBe(''); // graph unchanged after the throw

    // A direct self-route is a cycle too.
    expect(() => audio.setBusOutput('sfx', 'sfx')).toThrow(/cycle/);

    // Reset to master.
    audio.setBusOutput('dialogue', '');
    expect(audio.busOutput('dialogue')).toBe('');
  });

  it('tracks a bus effect insert and clears it, delegating to the backend', () => {
    const backend = new MockBackend();
    const audio = new Audio(backend, new AudioClips());
    expect(audio.busEffect('music')).toBeNull();

    const filter: BusEffect = { kind: 'filter', type: 'lowpass', frequency: 800 };
    audio.setBusEffect('music', filter);
    expect(audio.busEffect('music')).toEqual(filter);
    expect(backend.busEffects).toContainEqual(['music', filter]);

    audio.setBusEffect('music', null);
    expect(audio.busEffect('music')).toBeNull();
    expect(backend.busEffects[backend.busEffects.length - 1]).toEqual(['music', null]);
  });

  it('forwards a spatial route on play and pan to the backend', () => {
    const backend = new MockBackend();
    const audio = new Audio(backend, new AudioClips());
    const voice = audio.play(new AudioClip(new Uint8Array([1])), { spatial: true })!;
    expect(backend.playCalls[0]!.options?.spatial).toBe(true);
    audio.setPan(voice, -0.5);
    expect(backend.pans).toContainEqual([voice, -0.5]);
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
class StubFilterNode {
  type = 'lowpass';
  readonly frequency = new StubParam(350);
  readonly Q = new StubParam(1);
  readonly outputs: object[] = [];
  connect(target: object): void {
    this.outputs.push(target);
  }
  disconnect(): void {
    this.outputs.length = 0;
  }
}
class StubCompressorNode {
  readonly threshold = new StubParam(-24);
  readonly knee = new StubParam(30);
  readonly ratio = new StubParam(12);
  readonly attack = new StubParam(0.003);
  readonly release = new StubParam(0.25);
  readonly outputs: object[] = [];
  connect(target: object): void {
    this.outputs.push(target);
  }
  disconnect(): void {
    this.outputs.length = 0;
  }
}
class StubPannerNode {
  readonly pan = new StubParam(0);
  readonly outputs: object[] = [];
  connect(target: object): void {
    this.outputs.push(target);
  }
  disconnect(): void {
    this.outputs.length = 0;
  }
}
class StubAudioContext {
  state = 'running';
  readonly destination = { id: 'destination' };
  readonly created: StubGainNode[] = [];
  readonly filters: StubFilterNode[] = [];
  readonly panners: StubPannerNode[] = [];
  createGain(): StubGainNode {
    const g = new StubGainNode();
    this.created.push(g);
    return g;
  }
  createStereoPanner(): StubPannerNode {
    const p = new StubPannerNode();
    this.panners.push(p);
    return p;
  }
  createBufferSource(): StubBufferSource {
    return new StubBufferSource();
  }
  createBiquadFilter(): StubFilterNode {
    const f = new StubFilterNode();
    this.filters.push(f);
    return f;
  }
  createDynamicsCompressor(): StubCompressorNode {
    return new StubCompressorNode();
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

  it('reroutes a bus into a submix bus, then back to master', () => {
    const ctx = new StubAudioContext();
    const backend = new WebAudioBackend(ctx as unknown as AudioContext);
    const master = ctx.created[0]!;
    backend.setBusVolume('voice', 1); // creates the voice bus, wired to master
    const voiceBus = ctx.created[ctx.created.length - 1]!;

    backend.configureBus('dialogue', 'voice'); // dialogue → voice (submix)
    const dialogueBus = ctx.created[ctx.created.length - 1]!;
    expect(dialogueBus).not.toBe(voiceBus);
    expect(dialogueBus.outputs).toContain(voiceBus);
    expect(dialogueBus.outputs).not.toContain(master);

    backend.configureBus('dialogue', ''); // back to master
    expect(dialogueBus.outputs).toContain(master);
    expect(dialogueBus.outputs).not.toContain(voiceBus);
  });

  it('inserts a filter effect between the bus gain and its output, then removes it', () => {
    const ctx = new StubAudioContext();
    const backend = new WebAudioBackend(ctx as unknown as AudioContext);
    const master = ctx.created[0]!;
    backend.setBusVolume('music', 1); // create the music bus (gain → master)
    const musicBus = ctx.created[ctx.created.length - 1]!;

    backend.setBusEffect('music', { kind: 'filter', type: 'lowpass', frequency: 900, q: 0.7 });
    const filter = ctx.filters[ctx.filters.length - 1]!;
    expect(filter.type).toBe('lowpass');
    expect(filter.frequency.value).toBe(900);
    expect(filter.Q.value).toBe(0.7);
    // Chain is now gain → filter → master (not gain → master directly).
    expect(musicBus.outputs).toContain(filter);
    expect(musicBus.outputs).not.toContain(master);
    expect(filter.outputs).toContain(master);

    // Removing the effect reconnects the gain straight to master.
    backend.setBusEffect('music', null);
    expect(musicBus.outputs).toContain(master);
    expect(musicBus.outputs).not.toContain(filter);
  });

  it('keeps the effect in the chain across a submix reroute (gain → effect → target)', () => {
    const ctx = new StubAudioContext();
    const backend = new WebAudioBackend(ctx as unknown as AudioContext);
    backend.setBusVolume('voice', 1);
    const voiceBus = ctx.created[ctx.created.length - 1]!;
    backend.setBusVolume('dialogue', 1);
    const dialogueBus = ctx.created[ctx.created.length - 1]!;

    backend.setBusEffect('dialogue', { kind: 'compressor', ratio: 8 });
    backend.configureBus('dialogue', 'voice'); // reroute after the effect is set
    const fx = dialogueBus.outputs[0]!;
    expect(dialogueBus.outputs).toHaveLength(1); // gain → effect only
    expect((fx as { outputs: object[] }).outputs).toContain(voiceBus); // effect → voice submix
  });

  it('inserts a stereo panner only for a spatial voice, and setPan drives it', () => {
    const ctx = new StubAudioContext();
    const backend = new WebAudioBackend(ctx as unknown as AudioContext);
    const master = ctx.created[0]!;

    // Non-spatial voice → no panner (gain → master).
    const plain = backend.play(new AudioClip(new Uint8Array([1])))!;
    expect(ctx.panners).toHaveLength(0);
    backend.setPan(plain, 0.9); // no-op, no panner — must not throw
    const plainGain = ctx.created[ctx.created.length - 1]!;
    expect(plainGain.outputs).toContain(master);

    // Spatial voice → a panner between the gain and master.
    const spatial = backend.play(new AudioClip(new Uint8Array([2])), { spatial: true })!;
    const panner = ctx.panners[ctx.panners.length - 1]!;
    const spatialGain = ctx.created[ctx.created.length - 1]!;
    expect(spatialGain.outputs).toContain(panner);
    expect(spatialGain.outputs).not.toContain(master);
    expect(panner.outputs).toContain(master);

    backend.setPan(spatial, -0.5);
    expect(panner.pan.value).toBe(-0.5);
    backend.setPan(spatial, -3); // clamps to [-1, 1]
    expect(panner.pan.value).toBe(-1);
  });
});
