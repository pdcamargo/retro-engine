---
'@retro-engine/audio': minor
---

feat(audio): distance attenuation for spatial sources

Phase 4b of mixer buses (ADR-0168). A spatial `AudioSource` now fades with
distance from the `AudioListener`, not just pans. `AudioSource` gains
`refDistance` / `maxDistance` / `rolloff` (defaults `1` / `100` / `1`), applied
by the Web Audio **linear** model:

```
gain = 1 - rolloff * (d - refDistance) / (maxDistance - refDistance)   // d clamped to [ref, max]
```

Full volume within `refDistance`, fading to `1 - rolloff` at (and beyond)
`maxDistance`; `rolloff: 0` disables attenuation for a pan-only spatial source.
The attenuation rides its own per-voice gain node (`gain → spatialGain → panner
→ out`) so it never fights live volume sync — `AudioBackend.setSpatialGain` /
`Audio.setSpatialGain` drive it, a no-op for non-spatial voices. Non-spatial
audio is unchanged. Pure `attenuationForDistance` + the backend chain are
unit-tested (stub `AudioContext`).
