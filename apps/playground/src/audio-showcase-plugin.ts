// Device check for @retro-engine/audio Phase 1 (ADR-0147): plays sound through
// the Web Audio backend. Space / left-click fires a one-shot beep at a random
// pitch; M toggles a looping tone (music). The clips are generated as WAV bytes
// at runtime (no asset file needed) and played directly through the `Audio`
// resource. State is published to `window.__audio`.
//
// Open with `?mode=audio`. (Click once first — browsers keep audio suspended
// until a user gesture; the backend resumes automatically on that click.)

import { vec2, vec4 } from '@retro-engine/math';
import type { App } from '@retro-engine/engine';
import { Camera2d, ClearColorConfig, Commands, Res, ResMut, Sprite, Transform } from '@retro-engine/engine';
import { AudioClip, AudioPlugin, Audio } from '@retro-engine/audio';
import type { VoiceId } from '@retro-engine/audio';
import { InputPlugin, KeyboardInput, MouseButtonInput } from '@retro-engine/input';

interface AudioProbe {
  suspended: boolean;
  oneShots: number;
  looping: boolean;
}

declare global {
  interface Window {
    __audio?: AudioProbe;
  }
}

/** Generate a mono 16-bit PCM WAV of a fading sine tone — a tiny self-contained clip. */
const makeToneWav = (freq: number, durationSec: number, sampleRate = 44100): Uint8Array => {
  const numSamples = Math.floor(durationSec * sampleRate);
  const dataSize = numSamples * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeStr = (offset: number, s: string): void => {
    for (let i = 0; i < s.length; i += 1) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);
  for (let i = 0; i < numSamples; i += 1) {
    const t = i / sampleRate;
    const env = 1 - i / numSamples;
    const sample = Math.sin(2 * Math.PI * freq * t) * env * 0.4;
    view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, sample)) * 32767, true);
  }
  return new Uint8Array(buffer);
};

export const audioShowcasePlugin = (app: App): void => {
  const canvas = document.getElementById('playground-canvas');
  app.addPlugin(new InputPlugin(canvas instanceof HTMLCanvasElement ? { pointerTarget: canvas } : {}));
  app.addPlugin(new AudioPlugin());

  const beep = new AudioClip(makeToneWav(660, 0.15));
  const music = new AudioClip(makeToneWav(220, 1.5));
  let musicVoice: VoiceId | null = null;
  let oneShots = 0;

  app.addSystem('startup', [Commands], (cmd) => {
    cmd.spawn(...Camera2d({ clearColor: ClearColorConfig.custom({ r: 0.05, g: 0.06, b: 0.09, a: 1 }) }));
    cmd.spawn(new Sprite({ color: vec4.create(0.4, 0.9, 1, 1), customSize: vec2.create(96, 96) }), new Transform());
  });

  app.addSystem(
    'update',
    [ResMut(Audio), Res(KeyboardInput), Res(MouseButtonInput)],
    (audio, keys, mouse) => {
      if (keys.justPressed('Space') || mouse.justPressed('Left')) {
        audio.play(beep, { volume: 0.7, pitch: 0.8 + Math.random() * 0.6 });
        oneShots += 1;
      }
      if (keys.justPressed('KeyM')) {
        if (musicVoice !== null) {
          audio.stop(musicVoice);
          musicVoice = null;
        } else {
          musicVoice = audio.play(music, { volume: 0.3, loop: true });
        }
      }
      window.__audio = { suspended: audio.suspended(), oneShots, looping: musicVoice !== null };
    },
  );
};
