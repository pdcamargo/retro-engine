---
'@retro-engine/audio': minor
---

feat(audio): 3D source directivity cones

A 3D spatial `AudioSource` can now be **directional** (a speaker, TV, or NPC that
sounds louder in front): `coneInnerAngle` / `coneOuterAngle` / `coneOuterGain`
(matching Web Audio, defaults `360`/`360`/`0` = omnidirectional, so existing 3D
sources are unchanged). The `audio-spatial` system drives the panner's facing from
the source's `GlobalTransform` (`-Z`) via a new `AudioBackend.setSourceOrientation`,
so the cone tracks the source's rotation:

```ts
new AudioSource(clip, { spatial: true, spatialMode: '3d', coneInnerAngle: 60, coneOuterAngle: 120, coneOuterGain: 0.1 });
```

`PannerConfig` carries the cone params; the WebAudio backend sets them on the
`PannerNode`; the `Null` backend no-ops. Unit-tested (stub `AudioContext`).
Completes 3D spatial audio (position + listener orientation + source cones);
reverb / sidechain remain.
