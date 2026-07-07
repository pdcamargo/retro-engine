---
'@retro-engine/audio': minor
---

feat(audio): inverse + exponential distance models for spatial sources

Phase 4c of mixer buses — completes the distance-falloff models ADR-0168 deferred.
`AudioSource.distanceModel` selects `'linear'` (default, unchanged), `'inverse'`
(`ref / (ref + rolloff·(d−ref))` — physically-plausible `1/d` falloff), or
`'exponential'` (`(d/ref)^(−rolloff)` — steeper, designer-tunable), matching the
Web Audio `PannerNode` models:

```ts
new AudioSource(clip, { spatial: true, distanceModel: 'inverse', refDistance: 2 });
```

The `'inverse'` / `'exponential'` curves ignore `maxDistance` (they never quite
reach zero); `rolloff: 0` or a non-positive `refDistance` disables attenuation.
`attenuationForDistance` gains the `model` parameter (defaulting to `'linear'`, so
existing calls are unchanged). Unit-tested.
