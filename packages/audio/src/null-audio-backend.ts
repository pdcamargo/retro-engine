import type { AudioBackend, VoiceId } from './audio-backend';

/**
 * No-op {@link AudioBackend} for headless environments (tests, server worlds)
 * with no `AudioContext`. Every {@link NullAudioBackend.play} returns `null`;
 * all other methods are inert. `AudioPlugin` installs this automatically when
 * Web Audio is unavailable.
 */
export class NullAudioBackend implements AudioBackend {
  private volume = 1;

  resume(): void {}

  suspended(): boolean {
    return true;
  }

  play(): VoiceId | null {
    return null;
  }

  stop(): void {}

  stopAll(): void {}

  setVolume(): void {}

  isPlaying(): boolean {
    return false;
  }

  setMasterVolume(volume: number): void {
    this.volume = volume;
  }

  masterVolume(): number {
    return this.volume;
  }

  destroy(): void {}
}
