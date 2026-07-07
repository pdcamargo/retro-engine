# ADR-0159: Audio mixer buses

- **Status:** Accepted
- **Date:** 2026-07-06
- **Extends:** ADR-0147 (audio core — sealed)

## Context

ADR-0147 shipped the audio core: an `AudioBackend` HAL, per-voice gain, and a
single **master** gain (`source → voice.gain → master → destination` in the
`WebAudioBackend`). That gives per-sound and global volume, but not the grouping
every game needs: a **music** slider separate from **sfx** separate from **ui**,
each adjustable without touching individual sounds. The `AudioSource` TSDoc
already names mixer buses as the P1 follow-up.

The Web Audio API makes this natural: an `AudioNode` input is a **unity-gain
summing junction**, so many per-voice `GainNode`s can fan into one bus `GainNode`,
and the bus feeds master. Setting the bus gain scales every voice routed to it,
and per-voice gain, bus gain, and master gain simply multiply. (Confirmed against
MDN's Web Audio / AudioNode docs, per §2.)

## Decision

Insert named **bus gain stages** between a voice and master, addressed by string
name.

- **HAL (`AudioBackend`)** gains:
  - `PlayOptions.bus?: string` — route this voice through the named bus; omitted
    routes straight to master (unchanged default behavior).
  - `setBusVolume(bus, volume)` / `busVolume(bus)` — per-bus linear gain. A bus is
    created lazily on first reference (play or `setBusVolume`); an unqueried bus
    reads `1`.
- **`WebAudioBackend`** keeps a `Map<string, GainNode>`; each bus node connects to
  master once, and a voice with `options.bus` connects its `voice.gain` to that
  bus node instead of master. Per-voice `setVolume`, bus volume, and master all
  multiply down the chain — the standard mixing-board topology. Buses live for the
  backend's lifetime (torn down in `destroy`), not per voice.
- **`NullAudioBackend`** stores bus volumes in a map so `setBusVolume` /
  `busVolume` round-trip headlessly (parity with `masterVolume`), producing no
  sound.
- **`Audio` resource** forwards `setBusVolume` / `busVolume` so game systems set a
  bus without touching the backend.
- **`AudioSource.bus: string`** (authored, serialized; default `''` = master) so
  an entity's sound declares its bus. `reconcileAudio` passes it through
  `PlayOptions` when non-empty. The reflection schema registers `bus: t.string`.

**Buses are string-keyed, not a declared enum.** Names like `'music'` / `'sfx'`
are conventions, not a fixed set — a game defines whatever buses it wants, and an
unknown/misspelled name simply creates a new (unity-gain) bus rather than erroring.
This matches the label/set choice in ADR-0158 and keeps the HAL free of a
game-specific taxonomy.

## Consequences

- A game sets `audio.setBusVolume('music', 0.3)` once and every music voice dims,
  with SFX untouched — the headline mixer feature.
- Routing is additive: existing code that never passes `bus` behaves exactly as
  before (voice → master).
- Bus gain, voice gain, and master gain compose multiplicatively, so a per-voice
  fade and a bus duck stack correctly with no special handling.
- **Deferred:** bus-to-bus routing / submix trees (buses feed master only for
  now), send/aux effects, and spatial panning off the listener transform. A bus
  currently has only a linear gain; an effect insert (filter, compressor) is a
  later phase. Tracked in the roadmap slug.

## Implementation

- `packages/audio/src/audio-backend.ts` — `PlayOptions.bus`; `setBusVolume` /
  `busVolume` on the HAL.
- `packages/audio/src/web-audio-backend.ts` — bus `GainNode` map + lazy creation +
  routing.
- `packages/audio/src/null-audio-backend.ts` — headless bus-volume store.
- `packages/audio/src/audio-resource.ts` — `Audio.setBusVolume` / `busVolume`.
- `packages/audio/src/audio-source.ts` — `AudioSource.bus` + option.
- `packages/audio/src/audio-playback.ts` — pass `bus` when starting a voice.
- `packages/audio/src/audio-plugin.ts` — `bus` in the `AudioSource` schema.
