---
'@retro-engine/audio': minor
---

feat(audio): Phase 1 — audio HAL + Web Audio backend + AudioClip (`@retro-engine/audio`)

Per ADR-0147, a new audio package layered on the engine (like `@retro-engine/input`), with the same API in the browser and the Tauri webview. Add `AudioPlugin`, load an `AudioClip`, and play it through the `Audio` resource. Headless-safe (a no-op backend when Web Audio is absent).

**New public surface:**

- `AudioBackend` interface (`play` / `stop` / `stopAll` / `setVolume` / `isPlaying` / master volume / `resume` / `suspended`) with `VoiceId` handles and `PlayOptions { volume, loop, pitch }`.
- `WebAudioBackend` — `AudioContext` + master gain; lazy per-clip decode cache; each play builds a fresh `AudioBufferSourceNode → GainNode → master` (one-shots self-free, loops until stopped); auto-resumes the context on the first pointer/key event (autoplay policy).
- `NullAudioBackend` — no-op for headless/tests.
- `AudioClip` — asset holding the **encoded** bytes (loads with no `AudioContext`), + `createAudioClipImporter`, registered as a discoverable `largeBinary` kind on `.wav` / `.ogg` / `.mp3` with a loader and `.meta`.
- `Audio` — ECS-facing resource facade that resolves clip handles and delegates to the backend; `AudioClips` store; `AudioPlugin` (opt-in backend selection).

One-shot + looping playback with per-voice volume/pitch. ECS `AudioSource`/`AudioListener` components + reflection + an entity-driven SFX/music sample are Phase 2; mixer buses are P1. Playground `?mode=audio` demonstrates beep + looping tone through the backend.
