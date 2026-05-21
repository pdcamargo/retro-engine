# Audio System

- **Created:** 2026-05-21
- **Status:** Planning

## Goal

An audio system that mirrors the renderer's HAL pattern: a thin interface in `packages/audio-core` and a Web Audio implementation in `packages/audio-web`. Plays back asset-system-managed sounds and music, supports spatial audio, mixer buses, and basic effects.

## Phases

1. **Audio HAL** — `AudioBackend` interface (load, play, stop, set volume, attach effect, spatialize).
2. **Web Audio backend** — implements the HAL using `AudioContext`, `AudioBufferSourceNode`, `GainNode`, `PannerNode`.
3. **Asset integration** — `AudioClip` asset type with importer for `.wav`, `.ogg`, `.mp3`.
4. **ECS bindings** — `AudioSource` component, `AudioListener` component, system that polls transforms and updates spatial positions.
5. **Mixer buses** — named buses (Music, SFX, Voice) with per-bus volume + effects.
6. **Studio integration** — audio preview, waveform display.

## Open questions

- Streaming vs decoded-in-memory: large music files should stream.
- Web Audio's `AudioContext` autoplay restrictions: how does the engine get a user-gesture promise from the studio shell?
- Latency: Web Audio's quantum-based scheduling vs game frame timing.

## Links

- Bevy audio
- Web Audio spec
