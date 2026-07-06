// Device check for @retro-engine/audio (ADR-0147) — the ECS path. A music entity
// (`AudioSource`, looping) plays on spawn; an `AudioListener` sets master volume.
// Space / left-click spawns a one-shot SFX `AudioSource` that despawns itself when
// it finishes (despawnOnEnd). M toggles the music via the source's play()/stop().
// Clips are generated as WAV bytes at runtime and added to the `AudioClips` store
// to get handles. State is published to `window.__audio`.
//
// Open with `?mode=audio`. (Click once first — browsers keep audio suspended until
// a user gesture; the backend resumes automatically on that click.)

import { vec2, vec4 } from '@retro-engine/math';
import type { App } from '@retro-engine/engine';
import { Camera2d, ClearColorConfig, Commands, Query, Res, Sprite, Transform } from '@retro-engine/engine';
import {
  AudioClip,
  AudioClips,
  AudioListener,
  AudioPlugin,
  AudioSource,
  AudioVoices,
} from '@retro-engine/audio';
import { InputPlugin, KeyboardInput, MouseButtonInput } from '@retro-engine/input';

/** Marker for the looping music source. */
class MusicTag {}

interface AudioProbe {
  oneShots: number;
  musicPlaying: boolean;
  voices: number;
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
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
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

  // Add generated clips to the store to get handles (AudioSource references clips by handle).
  const clips = app.getResource(AudioClips)!;
  const beep = clips.add(new AudioClip(makeToneWav(660, 0.15)));
  const music = clips.add(new AudioClip(makeToneWav(220, 1.5)));

  let oneShots = 0;
  let musicPlaying = true;

  app.addSystem('startup', [Commands], (cmd) => {
    cmd.spawn(...Camera2d({ clearColor: ClearColorConfig.custom({ r: 0.05, g: 0.06, b: 0.09, a: 1 }) }));
    cmd.spawn(new AudioListener(0.8)); // master volume 0.8
    cmd.spawn(new AudioSource(music, { loop: true, volume: 0.3 }), new MusicTag());
    cmd.spawn(new Sprite({ color: vec4.create(0.4, 0.9, 1, 1), customSize: vec2.create(96, 96) }), new Transform());
  });

  app.addSystem(
    'update',
    [Commands, Res(KeyboardInput), Res(MouseButtonInput), Res(AudioVoices), Query([AudioSource], { with: [MusicTag] })],
    (cmd, keys, mouse, voices, musicSources) => {
      // One-shot SFX: spawn a self-cleaning AudioSource entity per trigger.
      if (keys.justPressed('Space') || mouse.justPressed('Left')) {
        cmd.spawn(new AudioSource(beep, { despawnOnEnd: true, pitch: 0.8 + Math.random() * 0.6 }));
        oneShots += 1;
      }
      // Toggle the looping music via the source's play()/stop() request flags.
      if (keys.justPressed('KeyM')) {
        musicPlaying = !musicPlaying;
        for (const [source] of musicSources) {
          if (musicPlaying) source.play();
          else source.stop();
        }
      }
      window.__audio = { oneShots, musicPlaying, voices: voices.size };
    },
  );
};
