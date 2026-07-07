# ADR-0171: Audio 3D positional mode (PannerNode)

- **Status:** Accepted
- **Date:** 2026-07-07
- **Extends:** ADR-0147 (audio core), ADR-0165 (2D stereo panning), ADR-0168 (distance attenuation) — sealed

## Context

ADR-0165 shipped 2D stereo panning and deliberately chose the cheap
`StereoPannerNode` (equal-power left/right) over the full `PannerNode`, since the
engine is 2D-first. ADR-0168 added distance attenuation on a separate per-voice
gain. But a 3D game wants **positional** audio — elevation, front/back, and HRTF
binaural cues — which only Web Audio's `PannerNode` provides (confirmed against
MDN, per §2): it takes a 3D `positionX/Y/Z` and an `AudioContext.listener`
position, and computes panning **and** distance attenuation itself from a
`panningModel` + `distanceModel`.

## Decision

Add an opt-in **3D spatial mode** alongside the existing 2D path, selected per
source, never replacing it.

- **`AudioSource.spatialMode: '2d' | '3d'`** (default `'2d'`). Only meaningful with
  `spatial: true`. `'2d'` is the unchanged StereoPanner + attenuation-gain path;
  `'3d'` uses a `PannerNode`.
- **A 3D voice is a `PannerNode`, not StereoPanner + gain.** `PlayOptions.panner`
  (a `PannerConfig`: `panningModel` + `distanceModel` + `refDistance` /
  `maxDistance` / `rolloff`) makes `play` build `gain → PannerNode → out`. The
  panner does panning *and* distance attenuation internally, so the 2D
  `spatialGain` / `StereoPanner` are not created for a 3D voice — `panner` and
  `spatial` are mutually exclusive in `PlayOptions`. Default `panningModel` is
  `'HRTF'` (realistic binaural); it reuses the source's ADR-0168 distance fields.
- **Two new HAL calls.** `setSpatialPosition(voice, x, y, z)` drives a 3D voice's
  panner position; `setListenerPosition(x, y, z)` sets the shared listener. The
  `audio-spatial` system, for a `'3d'` source, sets the voice position from its
  `GlobalTransform` and the listener from the `AudioListener`'s — no `setPan` /
  `setSpatialGain` (the panner handles both). 2D sources take the existing path.
  Uses the modern `positionX/Y/Z` AudioParams with a deprecated `setPosition`
  fallback.
- **Headless / Null backend no-ops** both new calls, and the reconciler's
  `startVoice` only passes `panner` for `spatialMode: '3d'` — so 2D audio, and all
  existing behavior, is byte-for-byte unchanged.

## Consequences

- `new AudioSource(clip, { spatial: true, spatialMode: '3d' })` on a positioned
  entity, with an `AudioListener` on the camera, gives full 3D positional audio
  (elevation, front/back, HRTF) automatically.
- The 2D path (the default, and the right choice for 2D games) is untouched and
  keeps its cheaper StereoPanner + explicit attenuation gain.
- **Deferred:** listener *orientation* (forward/up vectors — position only for
  now), source directionality (cone), and Doppler (velocity). All are `PannerNode`
  / listener features that layer on without disturbing this slice.

## Implementation

- `packages/audio/src/audio-backend.ts` — `PannerConfig`, `PlayOptions.panner`, `setSpatialPosition` / `setListenerPosition`.
- `packages/audio/src/web-audio-backend.ts` — per-voice `PannerNode` (`gain → panner3d → out`), position + listener setters.
- `packages/audio/src/null-audio-backend.ts` — no-op the two setters.
- `packages/audio/src/audio-resource.ts` — facade passthrough.
- `packages/audio/src/audio-source.ts` — `spatialMode` + `SpatialMode`.
- `packages/audio/src/audio-playback.ts` — `startVoice` passes a `panner` config for 3D.
- `packages/audio/src/audio-plugin.ts` — `spatialMode` schema + the `audio-spatial` 3D branch.
