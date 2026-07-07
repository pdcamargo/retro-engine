import type { AudioClip } from './audio-clip';
import type { AudioBackend, BusEffect, PlayOptions, VoiceId } from './audio-backend';

/** Internal per-voice bookkeeping. */
interface Voice {
  /** The source node, or `null` while its clip is still decoding. */
  source: AudioBufferSourceNode | null;
  readonly gain: GainNode;
  readonly loop: boolean;
  readonly pitch: number;
  stopped: boolean;
  cleaned: boolean;
}

/**
 * {@link AudioBackend} backed by the Web Audio API. Owns an `AudioContext` and a
 * master `GainNode`; decodes each {@link AudioClip} lazily on first play and
 * caches the resulting `AudioBuffer`. Each play builds a fresh
 * `AudioBufferSourceNode → GainNode → master` (source nodes are single-use), so
 * the same clip can overlap itself. Automatically resumes the context on the
 * first pointer/key event to satisfy the browser autoplay policy.
 */
export class WebAudioBackend implements AudioBackend {
  private readonly ctx: AudioContext;
  private readonly master: GainNode;
  private readonly buses = new Map<string, GainNode>();
  /** Per-bus output target (`''` = master) and effect node, for chain rebuilds. */
  private readonly busOutputs = new Map<string, string>();
  private readonly busEffects = new Map<string, AudioNode>();
  private readonly decodeCache = new Map<AudioClip, AudioBuffer>();
  private readonly decoding = new Map<AudioClip, Promise<AudioBuffer | null>>();
  private readonly voices = new Map<VoiceId, Voice>();
  private nextVoiceId = 1;
  private resumeHandler: (() => void) | undefined;

  constructor(context?: AudioContext) {
    this.ctx = context ?? new AudioContext();
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    this.attachResume();
  }

  resume(): void {
    if (this.ctx.state !== 'running') void this.ctx.resume();
  }

  suspended(): boolean {
    return this.ctx.state !== 'running';
  }

  play(clip: AudioClip, options?: PlayOptions): VoiceId | null {
    const id = this.nextVoiceId as VoiceId;
    this.nextVoiceId += 1;

    const gain = this.ctx.createGain();
    gain.gain.value = options?.volume ?? 1;
    gain.connect(options?.bus !== undefined ? this.bus(options.bus) : this.master);

    const voice: Voice = {
      source: null,
      gain,
      loop: options?.loop ?? false,
      pitch: options?.pitch ?? 1,
      stopped: false,
      cleaned: false,
    };
    this.voices.set(id, voice);

    const cached = this.decodeCache.get(clip);
    if (cached !== undefined) {
      this.startVoice(id, voice, cached);
    } else {
      void this.decodeClip(clip).then((buffer) => {
        if (buffer !== null && !voice.stopped) this.startVoice(id, voice, buffer);
        else if (buffer === null) this.cleanupVoice(id, voice);
      });
    }
    return id;
  }

  stop(voice: VoiceId): void {
    const v = this.voices.get(voice);
    if (v === undefined) return;
    v.stopped = true;
    if (v.source !== null) {
      try {
        v.source.stop();
      } catch {
        // Already stopped or not yet started — safe to ignore.
      }
    }
    this.cleanupVoice(voice, v);
  }

  stopAll(): void {
    // Snapshot: stop() deletes from the map as it goes.
    for (const id of Array.from(this.voices.keys())) this.stop(id);
  }

  setVolume(voice: VoiceId, volume: number): void {
    const v = this.voices.get(voice);
    if (v !== undefined) v.gain.gain.value = volume;
  }

  isPlaying(voice: VoiceId): boolean {
    return this.voices.has(voice);
  }

  setMasterVolume(volume: number): void {
    this.master.gain.value = volume;
  }

  masterVolume(): number {
    return this.master.gain.value;
  }

  setBusVolume(bus: string, volume: number): void {
    this.bus(bus).gain.value = volume;
  }

  busVolume(bus: string): number {
    return this.buses.get(bus)?.gain.value ?? 1;
  }

  configureBus(bus: string, output: string): void {
    this.busOutputs.set(bus, output);
    this.rebuildBus(bus);
  }

  setBusEffect(bus: string, effect: BusEffect | null): void {
    const old = this.busEffects.get(bus);
    if (old !== undefined) old.disconnect();
    if (effect === null) this.busEffects.delete(bus);
    else this.busEffects.set(bus, this.makeEffect(effect));
    this.rebuildBus(bus);
  }

  destroy(): void {
    this.stopAll();
    for (const fx of this.busEffects.values()) fx.disconnect();
    this.busEffects.clear();
    for (const bus of this.buses.values()) bus.disconnect();
    this.buses.clear();
    this.detachResume();
    void this.ctx.close();
  }

  /** The bus gain node for `name`, created (and wired to master) on first use. */
  private bus(name: string): GainNode {
    let node = this.buses.get(name);
    if (node === undefined) {
      node = this.ctx.createGain();
      node.connect(this.master);
      this.buses.set(name, node);
    }
    return node;
  }

  /**
   * Rewire a bus's output chain to `gain → [effect] → output` (output = its
   * target bus, or master). A bus has exactly one output edge, so dropping and
   * re-adding is safe; voices feed the gain as inputs and are unaffected.
   */
  private rebuildBus(name: string): void {
    const gain = this.bus(name);
    gain.disconnect();
    const outName = this.busOutputs.get(name) ?? '';
    const out = outName === '' ? this.master : this.bus(outName);
    const effect = this.busEffects.get(name);
    if (effect !== undefined) {
      gain.connect(effect);
      effect.disconnect();
      effect.connect(out);
    } else {
      gain.connect(out);
    }
  }

  /** Build the concrete Web Audio node for a described {@link BusEffect}. */
  private makeEffect(effect: BusEffect): AudioNode {
    if (effect.kind === 'filter') {
      const f = this.ctx.createBiquadFilter();
      f.type = effect.type;
      f.frequency.value = effect.frequency;
      if (effect.q !== undefined) f.Q.value = effect.q;
      return f;
    }
    const c = this.ctx.createDynamicsCompressor();
    if (effect.threshold !== undefined) c.threshold.value = effect.threshold;
    if (effect.knee !== undefined) c.knee.value = effect.knee;
    if (effect.ratio !== undefined) c.ratio.value = effect.ratio;
    if (effect.attack !== undefined) c.attack.value = effect.attack;
    if (effect.release !== undefined) c.release.value = effect.release;
    return c;
  }

  private startVoice(id: VoiceId, voice: Voice, buffer: AudioBuffer): void {
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = voice.loop;
    source.playbackRate.value = voice.pitch;
    source.connect(voice.gain);
    source.onended = () => this.cleanupVoice(id, voice);
    voice.source = source;
    source.start();
  }

  private cleanupVoice(id: VoiceId, voice: Voice): void {
    if (voice.cleaned) return;
    voice.cleaned = true;
    if (voice.source !== null) voice.source.disconnect();
    voice.gain.disconnect();
    this.voices.delete(id);
  }

  private decodeClip(clip: AudioClip): Promise<AudioBuffer | null> {
    const pending = this.decoding.get(clip);
    if (pending !== undefined) return pending;
    // decodeAudioData detaches its input, so hand it an exact-size copy.
    const copy = clip.bytes.slice().buffer;
    const promise = this.ctx.decodeAudioData(copy).then(
      (buffer) => {
        this.decodeCache.set(clip, buffer);
        this.decoding.delete(clip);
        return buffer;
      },
      (err: unknown) => {
        this.decoding.delete(clip);
        console.warn('[audio] failed to decode clip', err);
        return null;
      },
    );
    this.decoding.set(clip, promise);
    return promise;
  }

  private attachResume(): void {
    if (typeof window === 'undefined') return;
    const handler = (): void => this.resume();
    this.resumeHandler = handler;
    window.addEventListener('pointerdown', handler);
    window.addEventListener('keydown', handler);
  }

  private detachResume(): void {
    if (this.resumeHandler === undefined || typeof window === 'undefined') return;
    window.removeEventListener('pointerdown', this.resumeHandler);
    window.removeEventListener('keydown', this.resumeHandler);
    this.resumeHandler = undefined;
  }
}
