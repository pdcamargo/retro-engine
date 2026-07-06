---
'@retro-engine/audio': minor
---

feat(audio): Phase 2 — ECS playback (`AudioSource` / `AudioListener`)

Per ADR-0147, component-driven audio, completing the core audio surface. Attach an `AudioSource` to an entity and it plays; remove it (or the entity) and it stops.

**New public surface:**

- `AudioSource` — authored component (reflection-registered): `clip` handle, `volume`, `pitch`, `loop`, `playOnAdd`, `despawnOnEnd`, plus `play()` / `stop()` for runtime (re)triggering. Live `volume` changes apply to the playing voice.
- `AudioListener` — component whose `volume` drives the master gain (reflection-registered).
- `AudioVoices` — runtime resource mapping source entity → active voice (not serialized).
- `reconcileAudio` + `AudioController` — the pure per-frame reconciler (benched): `playOnAdd` auto-start that retries until the async clip loads, explicit play/stop, live volume sync, despawn/drop of finished one-shots, and stop-on-removal.

`AudioPlugin` now registers the two components and runs the listener + playback systems in `postUpdate`. Playground `?mode=audio` plays looping music and one-shot SFX from entities (with self-despawn). Reconcile bench joins `bench:check`. Mixer buses, spatial panning, and studio audio preview remain P1/P2.
