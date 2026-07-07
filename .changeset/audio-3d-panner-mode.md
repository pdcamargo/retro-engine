---
'@retro-engine/audio': minor
---

feat(audio): 3D positional audio mode (PannerNode)

A spatial `AudioSource` can now opt into full 3D positional audio — elevation,
front/back, and HRTF binaural cues — via `spatialMode: '3d'` (ADR-0171). Alongside
the default 2D stereo path, a 3D voice uses a Web Audio `PannerNode` (`gain →
panner → out`) that does panning *and* distance attenuation itself from the voice
position vs. the listener:

```ts
new AudioSource(clip, { spatial: true, spatialMode: '3d', maxDistance: 50 });
```

The `audio-spatial` system drives each 3D voice's position from its
`GlobalTransform` and the shared listener from the `AudioListener` (new
`AudioBackend.setSpatialPosition` / `setListenerPosition`; `PlayOptions.panner` /
`PannerConfig`). It reuses the source's `refDistance`/`maxDistance`/`rolloff`/
`distanceModel` for the panner's internal falloff; `panningModel` defaults to
`'HRTF'`. The 2D path (the default) is unchanged; the `Null` backend no-ops.
Unit-tested (stub `AudioContext`). Listener orientation, cones, and Doppler are
follow-ups.
