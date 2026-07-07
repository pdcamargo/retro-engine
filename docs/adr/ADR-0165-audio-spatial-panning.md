# ADR-0165: Audio spatial panning (2D stereo)

- **Status:** Accepted
- **Date:** 2026-07-07
- **Extends:** ADR-0147 (audio core), ADR-0159 (mixer buses) — sealed

## Context

Audio was positionless: every voice played centered. A 2D game wants a sound to
pan toward where it happens — footsteps to the left when the source is left of the
camera/listener. Web Audio offers two tools: the full `PannerNode` (3D position,
orientation, distance model, HRTF) and the much cheaper `StereoPannerNode`
(equal-power left/right pan in `[-1, 1]`) (confirmed against MDN, per §2). For a
2D-first engine, full 3D HRTF is overkill; stereo pan by horizontal position is
the right first cut.

## Decision

Opt-in **stereo panning** driven by world position, pan-only for now.

- **`StereoPannerNode` per spatial voice.** `PlayOptions.spatial` gives a voice a
  panner inserted between its gain and its output (`gain → panner → bus/master`);
  a non-spatial voice connects straight through (no panner, no cost, existing
  chain unchanged). `AudioBackend.setPan(voice, pan)` sets it (`[-1, 1]`, clamped);
  a no-op for a non-spatial voice or the `Null` backend.
- **`AudioSource.spatial` + `panWidth`.** An authored source opts in; `panWidth`
  is the world-space horizontal offset from the listener at which the pan reaches
  full left/right. Both serialized.
- **Position → pan is pure.** `panForOffset(sourceX, listenerX, panWidth)` clamps
  `(sourceX − listenerX) / panWidth` to `[-1, 1]`. Unit-tested independently of
  the ECS and Web Audio.
- **The spatial system** (in `postUpdate`, after `audio-playback`) reads each
  spatial source's `GlobalTransform` and the first `AudioListener` that has a
  `GlobalTransform`, computes the pan from their world X, and calls `setPan` on
  the source's live voice. It uses the current-frame transform (a frame of audio
  latency is inaudible), so it needs no strict ordering against transform
  propagation.

**Pan-only, deliberately.** Distance attenuation is *not* in this slice: it would
scale a voice's gain, which the playback reconciler already drives from
`AudioSource.volume` each frame, so the two need an explicit combine (and a
falloff-model decision — linear vs. inverse vs. clamped). Pan is an independent
axis with no such conflict, so it ships cleanly first; attenuation is a tracked
follow-up.

## Consequences

- `new AudioSource(clip, { spatial: true })` on a positioned entity, with an
  `AudioListener` on the camera, pans by relative X automatically.
- Non-spatial audio is byte-for-byte unchanged (no panner in the chain), so the
  feature is zero-overhead until opted into.
- `StereoPannerNode` (not `PannerNode`) means 2D left/right only — no elevation,
  distance rolloff, or HRTF. A future 3D mode can add a `PannerNode` path behind
  the same `spatial` opt-in without disturbing this one.
- **Deferred:** distance attenuation, a full 3D `PannerNode` mode, and Doppler.

## Implementation

- `packages/audio/src/spatial.ts` — pure `panForOffset`.
- `packages/audio/src/audio-backend.ts` — `PlayOptions.spatial`; `setPan` on the HAL.
- `packages/audio/src/web-audio-backend.ts` — per-voice `StereoPannerNode`, `setPan`.
- `packages/audio/src/null-audio-backend.ts` — no-op `setPan`.
- `packages/audio/src/audio-resource.ts` — `Audio.setPan`.
- `packages/audio/src/audio-source.ts` — `spatial` + `panWidth`.
- `packages/audio/src/audio-plugin.ts` — schema fields + the `audio-spatial` system.
