# Audio System

- **Created:** 2026-05-21
- **Status:** In progress (Phases 1–2 shipped 2026-07-06; P0 AC met — mixer buses
  + studio integration remain as P1/P2)
- **ADR:** [ADR-0147](../adr/ADR-0147-audio-architecture.md)

## Goal

`@retro-engine/audio` — a single package (layered on the engine like
`@retro-engine/input`, not two `-core`/`-web` packages) with an `AudioBackend`
HAL seam and a Web Audio implementation. Plays asset-managed sounds and music
from ECS, the same in the browser and the Tauri webview. Headless-safe.

## Phases

### Phase 1 — HAL + Web Audio backend + AudioClip asset ✅ (2026-07-06)

- `AudioBackend` interface (`play` / `stop` / `stopAll` / `setVolume` /
  `isPlaying` / master volume / `resume` / `suspended`); `VoiceId` handles;
  `PlayOptions { volume, loop, pitch }`.
- `WebAudioBackend` (AudioContext, master gain, lazy decode cache, per-voice
  source→gain→master, autoplay-resume on first gesture) + `NullAudioBackend`.
- `AudioClip` asset (encoded bytes) + importer + `.meta` kind on `.wav`/`.ogg`/`.mp3`.
- `Audio` resource facade + `AudioPlugin` (opt-in, headless-safe backend select).
- Unit tests with a mock/null backend; playground `?mode=audio` sample.

### Phase 2 — ECS components (AudioSource / AudioListener) + systems ✅ (2026-07-06)

- `AudioSource` (clip handle, volume, pitch, loop, `playOnAdd`, `despawnOnEnd`,
  `play()`/`stop()`) + `AudioListener` (master volume) components,
  reflection-registered (§13); `AudioVoices` runtime resource (not serialized).
- `reconcileAudio` (pure, benched) runs in `postUpdate`: `playOnAdd` auto-start
  (retries until the async clip loads), explicit play/stop, live volume sync,
  despawn/drop finished one-shots, stop on source removal. Listener → master gain.
- Playground `?mode=audio` plays looping music + one-shot SFX from entities.
  **Completes the P0 Audio AC.**

### Phase 3 — Mixer buses (P1)

- Named buses (Master / Music / SFX / Voice) with per-bus volume + routing;
  basic spatial panning via `PannerNode` off the `AudioListener` transform.

### Phase 4 — Studio integration (P1/P2)

- Audio preview in the asset browser, waveform display, `AudioSource` inspector.

## Open questions (resolved / remaining)

- **HAL split?** → No: one package, internal `AudioBackend` seam (ADR-0147).
- **Autoplay / user gesture** → the backend self-resumes on the first
  pointer/key event; no host wiring needed (ADR-0147).
- **Decoded-in-memory vs streaming** → Phase 1 decodes fully in memory (cached).
  Streaming large music via `MediaElementAudioSourceNode` is a later option.
- **Latency: quantum scheduling vs frame timing** → fire-and-forget `start()` for
  Phase 1/2; sample-accurate scheduling deferred.

## Links

- [ADR-0147](../adr/ADR-0147-audio-architecture.md)
- Bevy audio; Web Audio API (MDN)
