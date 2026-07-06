import type { AudioClip } from './audio-clip';
import type { AudioBackend, PlayOptions, VoiceId } from './audio-backend';

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
    gain.connect(this.master);

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

  destroy(): void {
    this.stopAll();
    this.detachResume();
    void this.ctx.close();
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
