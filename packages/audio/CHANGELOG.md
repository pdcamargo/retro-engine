# @retro-engine/audio

## 0.1.0

### Minor Changes

- dc77f70: feat(audio): 3D positional audio mode (PannerNode)

  A spatial `AudioSource` can now opt into full 3D positional audio — elevation,
  front/back, and HRTF binaural cues — via `spatialMode: '3d'` (ADR-0171). Alongside
  the default 2D stereo path, a 3D voice uses a Web Audio `PannerNode` (`gain →
panner → out`) that does panning _and_ distance attenuation itself from the voice
  position vs. the listener:

  ```ts
  new AudioSource(clip, { spatial: true, spatialMode: "3d", maxDistance: 50 });
  ```

  The `audio-spatial` system drives each 3D voice's position from its
  `GlobalTransform` and the shared listener from the `AudioListener` (new
  `AudioBackend.setSpatialPosition` / `setListenerPosition`; `PlayOptions.panner` /
  `PannerConfig`). It reuses the source's `refDistance`/`maxDistance`/`rolloff`/
  `distanceModel` for the panner's internal falloff; `panningModel` defaults to
  `'HRTF'`. The 2D path (the default) is unchanged; the `Null` backend no-ops.
  Unit-tested (stub `AudioContext`). Listener orientation, cones, and Doppler are
  follow-ups.

- 0005673: feat(audio): bus effect inserts (filter / compressor)

  Audio mixer buses Phase 3 (ADR-0164). `Audio.setBusEffect(bus, effect | null)`
  inserts a described effect between a bus's gain and its output:

  ```ts
  audio.setBusEffect("music", {
    kind: "filter",
    type: "lowpass",
    frequency: 700,
  }); // muffle
  audio.setBusEffect("voice", { kind: "compressor", ratio: 8 }); // glue a submix
  audio.setBusEffect("music", null); // remove
  ```

  A `BusEffect` is plain data (`filter` → `BiquadFilterNode`, `compressor` →
  `DynamicsCompressorNode`), so it crosses the HAL and a headless backend drops it.
  `WebAudioBackend` funnels both effect changes and submix reroutes through one
  `rebuildBus`, so an effect survives a `setBusOutput` and vice-versa
  (`gain → effect → target`). `Audio.busEffect(bus)` reads the current spec.

- 6d9ad69: feat(audio): distance attenuation for spatial sources

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

- a3f3ed7: feat(audio): inverse + exponential distance models for spatial sources

  Phase 4c of mixer buses — completes the distance-falloff models ADR-0168 deferred.
  `AudioSource.distanceModel` selects `'linear'` (default, unchanged), `'inverse'`
  (`ref / (ref + rolloff·(d−ref))` — physically-plausible `1/d` falloff), or
  `'exponential'` (`(d/ref)^(−rolloff)` — steeper, designer-tunable), matching the
  Web Audio `PannerNode` models:

  ```ts
  new AudioSource(clip, {
    spatial: true,
    distanceModel: "inverse",
    refDistance: 2,
  });
  ```

  The `'inverse'` / `'exponential'` curves ignore `maxDistance` (they never quite
  reach zero); `rolloff: 0` or a non-positive `refDistance` disables attenuation.
  `attenuationForDistance` gains the `model` parameter (defaulting to `'linear'`, so
  existing calls are unchanged). Unit-tested.

- d14951c: feat(audio): 3D listener orientation (tracks camera rotation)

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

- 55eaa32: feat(audio): mixer buses — named groups with per-bus volume

  First slice of audio mixer buses (ADR-0159). Voices can route through a named bus
  (`music`, `sfx`, `ui`, …) whose volume scales every voice on it, independent of
  per-voice and master gain:

  ```ts
  cmd.spawn(new AudioSource(musicHandle, { loop: true, bus: "music" }));
  app.addSystem("update", [ResMut(Audio)], (audio) =>
    audio.setBusVolume("music", 0.3)
  );
  ```

  - `PlayOptions.bus` routes a voice; omitted goes straight to master (unchanged).
  - `Audio.setBusVolume(bus, volume)` / `busVolume(bus)` — per-bus linear gain.
  - `AudioSource.bus` (authored, serialized) declares an entity's bus.
  - `WebAudioBackend` inserts a `GainNode` per bus (`voice.gain → bus → master`);
    `NullAudioBackend` round-trips bus volumes headlessly. Buses are string-keyed
    and created on first use.

  Bus-to-bus submix trees, effect inserts, and spatial panning are tracked
  follow-ups.

- 242e450: feat(audio): Phase 1 — audio HAL + Web Audio backend + AudioClip (`@retro-engine/audio`)

  Per ADR-0147, a new audio package layered on the engine (like `@retro-engine/input`), with the same API in the browser and the Tauri webview. Add `AudioPlugin`, load an `AudioClip`, and play it through the `Audio` resource. Headless-safe (a no-op backend when Web Audio is absent).

  **New public surface:**

  - `AudioBackend` interface (`play` / `stop` / `stopAll` / `setVolume` / `isPlaying` / master volume / `resume` / `suspended`) with `VoiceId` handles and `PlayOptions { volume, loop, pitch }`.
  - `WebAudioBackend` — `AudioContext` + master gain; lazy per-clip decode cache; each play builds a fresh `AudioBufferSourceNode → GainNode → master` (one-shots self-free, loops until stopped); auto-resumes the context on the first pointer/key event (autoplay policy).
  - `NullAudioBackend` — no-op for headless/tests.
  - `AudioClip` — asset holding the **encoded** bytes (loads with no `AudioContext`), + `createAudioClipImporter`, registered as a discoverable `largeBinary` kind on `.wav` / `.ogg` / `.mp3` with a loader and `.meta`.
  - `Audio` — ECS-facing resource facade that resolves clip handles and delegates to the backend; `AudioClips` store; `AudioPlugin` (opt-in backend selection).

  One-shot + looping playback with per-voice volume/pitch. ECS `AudioSource`/`AudioListener` components + reflection + an entity-driven SFX/music sample are Phase 2; mixer buses are P1. Playground `?mode=audio` demonstrates beep + looping tone through the backend.

- 03f8990: feat(audio): Phase 2 — ECS playback (`AudioSource` / `AudioListener`)

  Per ADR-0147, component-driven audio, completing the core audio surface. Attach an `AudioSource` to an entity and it plays; remove it (or the entity) and it stops.

  **New public surface:**

  - `AudioSource` — authored component (reflection-registered): `clip` handle, `volume`, `pitch`, `loop`, `playOnAdd`, `despawnOnEnd`, plus `play()` / `stop()` for runtime (re)triggering. Live `volume` changes apply to the playing voice.
  - `AudioListener` — component whose `volume` drives the master gain (reflection-registered).
  - `AudioVoices` — runtime resource mapping source entity → active voice (not serialized).
  - `reconcileAudio` + `AudioController` — the pure per-frame reconciler (benched): `playOnAdd` auto-start that retries until the async clip loads, explicit play/stop, live volume sync, despawn/drop of finished one-shots, and stop-on-removal.

  `AudioPlugin` now registers the two components and runs the listener + playback systems in `postUpdate`. Playground `?mode=audio` plays looping music and one-shot SFX from entities (with self-despawn). Reconcile bench joins `bench:check`. Mixer buses, spatial panning, and studio audio preview remain P1/P2.

- 7606994: feat(audio): convolution reverb bus effect (synthesized IR, no asset)

  Adds a `reverb` `BusEffect` alongside `filter`/`compressor`:
  `setBusEffect(bus, { kind: 'reverb', seconds?, decay?, wet? })`. The WebAudio
  backend builds a `ConvolverNode` with a synthesized stereo impulse response — a
  leading unit impulse (so the dry signal passes through) followed by a
  decaying-noise tail — giving a self-contained wet/dry reverb in a single node,
  with no IR asset required. Composes with submix routing exactly like the other
  inserts; the null backend ignores it.

- 15e552c: feat(audio): 3D source directivity cones

  A 3D spatial `AudioSource` can now be **directional** (a speaker, TV, or NPC that
  sounds louder in front): `coneInnerAngle` / `coneOuterAngle` / `coneOuterGain`
  (matching Web Audio, defaults `360`/`360`/`0` = omnidirectional, so existing 3D
  sources are unchanged). The `audio-spatial` system drives the panner's facing from
  the source's `GlobalTransform` (`-Z`) via a new `AudioBackend.setSourceOrientation`,
  so the cone tracks the source's rotation:

  ```ts
  new AudioSource(clip, {
    spatial: true,
    spatialMode: "3d",
    coneInnerAngle: 60,
    coneOuterAngle: 120,
    coneOuterGain: 0.1,
  });
  ```

  `PannerConfig` carries the cone params; the WebAudio backend sets them on the
  `PannerNode`; the `Null` backend no-ops. Unit-tested (stub `AudioContext`).
  Completes 3D spatial audio (position + listener orientation + source cones);
  reverb / sidechain remain.

- 5865ba2: feat(audio): 2D spatial stereo panning

  Audio mixer buses Phase 4 (ADR-0165). A source can pan in stereo by its world
  position relative to the listener:

  ```ts
  cmd.spawn(
    new Transform(vec3.create(-6, 0, 0)),
    new AudioSource(sfx, { spatial: true, panWidth: 10 })
  );
  cmd.spawn(new Transform(), new AudioListener()); // the ears
  // → the sfx plays toward the left
  ```

  `AudioSource.spatial` + `panWidth` opt a source in; a `StereoPannerNode` is
  inserted per spatial voice (`gain → panner → bus`), and an `audio-spatial` system
  pans it by world X vs. the first transform-bearing `AudioListener` via a pure
  `panForOffset`. Non-spatial audio is unchanged (no panner, no cost); the `Null`
  backend no-ops. Distance attenuation and a full 3D `PannerNode` mode are tracked
  follow-ups.

- 7902604: feat(audio): submix buses (bus → bus routing)

  Audio mixer buses Phase 2 (ADR-0162). A bus can now route its output into another
  bus instead of master, forming a submix tree:

  ```ts
  audio.setBusOutput("dialogue", "voice");
  audio.setBusOutput("announcer", "voice");
  audio.setBusVolume("voice", 0.5); // ducks dialogue + announcer together
  ```

  `Audio` owns the bus graph and rejects any routing that would form a cycle
  (including a direct self-route), leaving the graph unchanged on rejection.
  `busOutput(bus)` reads the current target (`''` = master). The HAL's
  `configureBus(bus, output)` is a mechanical GainNode reconnect (`WebAudioBackend`
  rewires the bus's one output edge; `NullAudioBackend` no-ops). Bus gains compose
  multiplicatively down the chain.

- 056bfc9: feat: expose feature-component reflection registration independent of the plugins

  Each feature plugin now factors its component-schema registration into a standalone, exported function so a host (e.g. an editor's component palette) can register the component _types_ for authoring and serialization without installing the plugin's systems or render passes.

  New public surface:

  - `@retro-engine/physics-core`: `registerPhysicsComponents(app)` — all 2D/3D bodies, colliders, velocities, forces, materials, character controllers, and joints.
  - `@retro-engine/audio`: `registerAudioComponents(app)` — `AudioSource`, `AudioListener`.
  - `@retro-engine/input`: `registerInputComponents(app)` — `ActionBinding`/`ActionDef` value types + the `ActionMap` component.
  - `@retro-engine/ui`: `registerUiComponents(app)` — every UI component (layout, text, image, style class, button/toggle/slider/text-input, and the interaction/focus/diagnostics markers), plus the now-exported `uiButtonSchema` / `uiToggleSchema` / `uiSliderSchema` / `uiTextInputSchema`.
  - `@retro-engine/engine`: `registerSpriteComponents(app)`, `registerLight2dComponents(app)`, `registerTextComponents(app)` — the sprite (+ atlas), 2D light, and text component schemas.

  Each owning plugin's `build` now delegates to its function, so behavior is unchanged. Registering the same constructor twice is idempotent, so calling these alongside the full plugin is safe.

### Patch Changes

- Updated dependencies [45c51aa]
- Updated dependencies [1b9b7f5]
- Updated dependencies [7d40c1a]
- Updated dependencies [937f2cb]
- Updated dependencies [b315044]
- Updated dependencies [d5424c3]
- Updated dependencies [e0c4984]
- Updated dependencies [15617ff]
- Updated dependencies [ab6e7b9]
- Updated dependencies [1b66f35]
- Updated dependencies [0baa8a9]
- Updated dependencies [7142f6f]
- Updated dependencies [2c27d90]
- Updated dependencies [7e26e59]
- Updated dependencies [e73d32e]
- Updated dependencies [9c36012]
- Updated dependencies [12eb41d]
- Updated dependencies [773fabd]
- Updated dependencies [afc904c]
- Updated dependencies [3b3cf7f]
- Updated dependencies [2c27d90]
- Updated dependencies [a9837c6]
- Updated dependencies [f8079c6]
- Updated dependencies [e8c703e]
- Updated dependencies [2324f9f]
- Updated dependencies [294c161]
- Updated dependencies [597b913]
- Updated dependencies [6e1d04c]
- Updated dependencies [5ea3e80]
- Updated dependencies [2f22822]
- Updated dependencies [62e382e]
- Updated dependencies [5d7a21a]
- Updated dependencies [8d36fd7]
- Updated dependencies [3b04954]
- Updated dependencies [1280e03]
- Updated dependencies [fdde82f]
- Updated dependencies [9d41f83]
- Updated dependencies [056bfc9]
- Updated dependencies [1cdff13]
- Updated dependencies [1c76eef]
- Updated dependencies [d8b7fc2]
- Updated dependencies [5ea3e80]
- Updated dependencies [68963c6]
- Updated dependencies [be766a4]
- Updated dependencies [bc7640e]
- Updated dependencies [cad5613]
- Updated dependencies [4741039]
- Updated dependencies [4ca7beb]
- Updated dependencies [0bc6ca5]
- Updated dependencies [e163274]
- Updated dependencies [5317052]
- Updated dependencies [5599db7]
- Updated dependencies [5988cb6]
- Updated dependencies [a055d25]
- Updated dependencies [2a7a18b]
- Updated dependencies [da51d57]
- Updated dependencies [c2732c5]
- Updated dependencies [fad8a5e]
- Updated dependencies [1c4a0fe]
- Updated dependencies [c4bf47a]
- Updated dependencies [7812b83]
- Updated dependencies [8e4574a]
- Updated dependencies [be4aad1]
- Updated dependencies [88d0fc5]
- Updated dependencies [01070b1]
- Updated dependencies [b788a60]
- Updated dependencies [a3b6d83]
- Updated dependencies [43cae6c]
- Updated dependencies [90a56e2]
- Updated dependencies [88d3ca3]
- Updated dependencies [68ce298]
- Updated dependencies [b5e3322]
- Updated dependencies [10bda28]
- Updated dependencies [ca1cafa]
- Updated dependencies [e97fdd2]
- Updated dependencies [3db9d87]
- Updated dependencies [0c7b778]
- Updated dependencies [781aa88]
- Updated dependencies [7142f6f]
- Updated dependencies [eb3c452]
- Updated dependencies [e6728cc]
- Updated dependencies [8029403]
- Updated dependencies [d63d0f9]
- Updated dependencies [c049410]
- Updated dependencies [707714f]
- Updated dependencies [3658119]
- Updated dependencies [ac35dac]
- Updated dependencies [3280a8e]
- Updated dependencies [62effe1]
- Updated dependencies [ca677c6]
- Updated dependencies [abbd55c]
- Updated dependencies [67e8513]
- Updated dependencies [8ac39a9]
- Updated dependencies [92d6c91]
- Updated dependencies [75a1a8a]
- Updated dependencies [e6728cc]
- Updated dependencies [a896a3b]
- Updated dependencies [5be634a]
- Updated dependencies [690c811]
- Updated dependencies [da1f0eb]
- Updated dependencies [056bfc9]
- Updated dependencies [7dc7bca]
- Updated dependencies [5c33631]
- Updated dependencies [fa2678b]
- Updated dependencies [67e8513]
- Updated dependencies [836a7ab]
- Updated dependencies [ea56975]
- Updated dependencies [6fbb29d]
- Updated dependencies [d25c7aa]
- Updated dependencies [4015d71]
- Updated dependencies [82ecdec]
- Updated dependencies [bcef667]
- Updated dependencies [c26f7a3]
- Updated dependencies [7b8eeea]
- Updated dependencies [8a6fb8f]
- Updated dependencies [9712180]
- Updated dependencies [bc24cd2]
- Updated dependencies [f45c5f0]
- Updated dependencies [824b04f]
- Updated dependencies [47372a5]
- Updated dependencies [73fdef4]
- Updated dependencies [88c4629]
- Updated dependencies [93f4053]
- Updated dependencies [ba77627]
- Updated dependencies [f2f082b]
- Updated dependencies [641b263]
- Updated dependencies [7812b83]
- Updated dependencies [48686b4]
- Updated dependencies [f0584f2]
- Updated dependencies [bc634ae]
- Updated dependencies [f95bac1]
- Updated dependencies [7dddd6f]
- Updated dependencies [a0fb8d4]
- Updated dependencies [59d37c2]
- Updated dependencies [acae153]
- Updated dependencies [8934a75]
- Updated dependencies [f55bffb]
- Updated dependencies [b1a1e01]
- Updated dependencies [5b52805]
- Updated dependencies [dd3de07]
- Updated dependencies [d8c0bda]
- Updated dependencies [b10dc50]
- Updated dependencies [05d2bb6]
- Updated dependencies [0f8701d]
- Updated dependencies [7f40ed1]
- Updated dependencies [591fdef]
- Updated dependencies [42d7275]
- Updated dependencies [b2a610d]
- Updated dependencies [2beee52]
- Updated dependencies [5cf81f9]
- Updated dependencies [ce20898]
- Updated dependencies [823e5cd]
  - @retro-engine/engine@0.1.0
  - @retro-engine/reflect@0.1.0
  - @retro-engine/ecs@0.1.0
