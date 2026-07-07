# ADR-0168: Audio distance attenuation (linear model)

- **Status:** Accepted
- **Date:** 2026-07-07
- **Extends:** ADR-0147 (audio core), ADR-0159 (mixer buses), ADR-0165 (spatial panning) — sealed

## Context

ADR-0165 shipped stereo panning but deliberately deferred **distance attenuation**
— a spatial source growing quieter as it moves away from the listener — for two
reasons it named explicitly: attenuation scales a voice's gain, which the playback
reconciler already drives from `AudioSource.volume` every frame (so the two would
fight over one node), and it needs a falloff-model decision (linear vs. inverse
vs. exponential). This ADR resolves both and ships attenuation as the next spatial
slice.

Web Audio's `PannerNode` defines three distance models (confirmed against MDN, per
§2). The **linear** model is `1 - rolloff * (d - refDistance) / (maxDistance -
refDistance)` with `d` clamped to `[refDistance, maxDistance]` — bounded to
`[0, 1]`, reaching its floor at `maxDistance` and not fading further. Inverse and
exponential are unbounded-domain curves that never truly reach zero.

## Decision

Opt-in **linear distance attenuation** on spatial sources, on an axis independent
of volume.

- **Linear model.** Chosen because it is bounded and reaches a definite floor at
  `maxDistance` — a designer sets "inaudible past N units" directly, and a source
  fully outside its range costs nothing perceptually. Inverse/exponential are a
  future per-source option if a consumer needs physical falloff; they are not the
  right default for authored game audio.
- **A separate per-voice gain node.** A spatial voice's chain becomes `gain →
  spatialGain → panner → out`. The attenuation lives on its own `spatialGain`
  node, distinct from the volume `gain` the reconciler writes each frame, so the
  two never clobber each other — this is exactly the conflict ADR-0165 flagged.
  `AudioBackend.setSpatialGain(voice, gain)` drives it; a no-op for a non-spatial
  voice or the `Null` backend. Mirrors how the panner was added: one more node,
  built only when `spatial: true`, zero cost otherwise.
- **`AudioSource.refDistance` / `maxDistance` / `rolloff`.** Authored, serialized.
  Defaults `1` / `100` / `1`. `rolloff: 0` disables attenuation (pan-only spatial
  source) — the pure function returns `1` for a non-positive rolloff or a
  degenerate `maxDistance <= refDistance` range.
- **Distance → gain is pure.** `attenuationForDistance(distance, refDistance,
  maxDistance, rolloff)` implements the clamped linear model, unit-tested
  independently of the ECS and Web Audio.
- **The spatial system** (already in `postUpdate`, after `audio-playback`) now
  also computes the full 3D distance between each spatial source's
  `GlobalTransform` and the listener's, and calls `setSpatialGain` alongside the
  existing `setPan`. Pan still uses world X only; attenuation uses 3D distance.

## Consequences

- A positioned `new AudioSource(clip, { spatial: true })` now both pans and fades
  with distance automatically, with no combine against `volume` — the two gains
  multiply in the Web Audio graph.
- Non-spatial audio is byte-for-byte unchanged (no extra nodes), so the feature
  stays zero-overhead until opted into. Pan-only behaviour is still reachable via
  `rolloff: 0`.
- **Deferred:** inverse/exponential models, a full 3D `PannerNode` mode, Doppler,
  reverb/sidechain sends.

## Implementation

- `packages/audio/src/spatial.ts` — pure `attenuationForDistance` (alongside `panForOffset`).
- `packages/audio/src/audio-backend.ts` — `setSpatialGain` on the HAL.
- `packages/audio/src/web-audio-backend.ts` — per-voice `spatialGain` node (`gain → spatialGain → panner → out`), `setSpatialGain`.
- `packages/audio/src/null-audio-backend.ts` — no-op `setSpatialGain`.
- `packages/audio/src/audio-resource.ts` — `Audio.setSpatialGain`.
- `packages/audio/src/audio-source.ts` — `refDistance` / `maxDistance` / `rolloff`.
- `packages/audio/src/audio-plugin.ts` — schema fields + the `audio-spatial` system computing 3D distance.
