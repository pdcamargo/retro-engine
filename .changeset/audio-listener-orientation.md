---
'@retro-engine/audio': minor
---

feat(audio): 3D listener orientation (tracks camera rotation)

Completes 3D positional audio (ADR-0171): the listener now faces where the
`AudioListener`'s transform points, so a source to the camera's right correctly
moves to the left ear when the camera turns. The `audio-spatial` system derives
the listener's forward + up from its `GlobalTransform` (pure `listenerAxes` —
normalized `-Z` / `+Y` basis columns) and drives the new
`AudioBackend.setListenerOrientation`; the WebAudio backend sets the modern
`AudioListener.forwardX/upX` params (with a deprecated `setOrientation` fallback),
the `Null` backend no-ops. Without this, 3D panning ignored camera rotation.
Unit-tested (`listenerAxes` for identity / 180° yaw / scaled bases; backend +
facade forwarding).
