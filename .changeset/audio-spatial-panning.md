---
'@retro-engine/audio': minor
---

feat(audio): 2D spatial stereo panning

Audio mixer buses Phase 4 (ADR-0165). A source can pan in stereo by its world
position relative to the listener:

```ts
cmd.spawn(new Transform(vec3.create(-6, 0, 0)), new AudioSource(sfx, { spatial: true, panWidth: 10 }));
cmd.spawn(new Transform(), new AudioListener()); // the ears
// → the sfx plays toward the left
```

`AudioSource.spatial` + `panWidth` opt a source in; a `StereoPannerNode` is
inserted per spatial voice (`gain → panner → bus`), and an `audio-spatial` system
pans it by world X vs. the first transform-bearing `AudioListener` via a pure
`panForOffset`. Non-spatial audio is unchanged (no panner, no cost); the `Null`
backend no-ops. Distance attenuation and a full 3D `PannerNode` mode are tracked
follow-ups.
