# Audio mixer buses

Grouped volume control + routing on top of the ADR-0147 audio core. Promoted from
the P1 "Audio mixer buses" roadmap item.

## Phase 1 — named buses + per-bus volume ✅ (ADR-0159)

`PlayOptions.bus` + `Audio.setBusVolume/busVolume` + `AudioSource.bus`. Voices
route `voice.gain → bus → master`; per-voice/bus/master gains multiply. String-
keyed, lazily created; headless (Null) parity. Reflection schema updated. Unit +
stub-context tested.

## Phase 2 — submix trees (bus → bus) ✅ (ADR-0162)

`Audio.setBusOutput(bus, output)` routes a bus into another bus (or master when
`''`), forming a submix tree (`dialogue`/`announcer` → `voice` → master). The
`Audio` resource owns the bus graph + rejects cycles (including self-routes); the
HAL's `configureBus(bus, output)` is a mechanical GainNode reconnect
(`WebAudioBackend` rewires the one output edge; `Null` no-ops). `busOutput(bus)`
reads the current target. Unit + stub-context tested.

## Phase 3 — bus effect inserts ✅ (ADR-0164)

`Audio.setBusEffect(bus, effect | null)` inserts a described `BusEffect`
(`{ kind: 'filter', type, frequency, q? }` or `{ kind: 'compressor', … }`)
between a bus's gain and its output. `WebAudioBackend` builds a `BiquadFilterNode`
/ `DynamicsCompressorNode` and funnels both effect changes and submix reroutes
through one `rebuildBus` (`gain → [effect] → output`), so they compose;
`NullAudioBackend` no-ops. `Audio.busEffect(bus)` reads the spec. Unit +
stub-context tested (incl. effect surviving a submix reroute).

**Remaining:** multi-effect chains per bus, live param automation, reverb
(`ConvolverNode`) sends, sidechain ducking.

## Phase 4 — spatial audio 🟡 (ADR-0165, ADR-0168)

**4a — panning ✅ (ADR-0165):** `AudioSource.spatial` + `panWidth`; a
per-spatial-voice `StereoPannerNode` (`PlayOptions.spatial`, `Audio.setPan`); the
`audio-spatial` system pans each spatial voice by its world X vs. the first
transform-bearing `AudioListener`, via pure `panForOffset`. Non-spatial audio is
unchanged (no panner). Unit + stub-context tested.

**4b — distance attenuation ✅ (ADR-0168):** `AudioSource.refDistance`/
`maxDistance`/`rolloff`; the Web Audio **linear** model on a separate per-voice
`spatialGain` node (`gain → spatialGain → panner → out`) so attenuation never
fights the reconciler's volume sync — resolving the exact combine ADR-0165 flagged.
Pure `attenuationForDistance` (`rolloff: 0` / degenerate range → no attenuation);
the same system computes the full 3D source↔listener distance and drives
`Audio.setSpatialGain`. Unit + stub-context tested.

**4c — falloff models ✅:** `AudioSource.distanceModel` selects `'linear'`
(default), `'inverse'` (`ref/(ref+rolloff·(d−ref))`), or `'exponential'`
(`(d/ref)^(−rolloff)`), matching the Web Audio `PannerNode` models;
`attenuationForDistance` gained a `model` param (defaults `'linear'`, so existing
callers are unchanged). Inverse/exponential ignore `maxDistance` (never reach
zero). Unit-tested.

**4d — 3D positional mode ✅ (ADR-0171):** `AudioSource.spatialMode: '2d'|'3d'`
(default `'2d'`). A `'3d'` voice uses a Web Audio `PannerNode` (`gain → panner →
out`) that does panning + distance attenuation itself; `PlayOptions.panner` /
`PannerConfig`, `AudioBackend.setSpatialPosition` / `setListenerPosition`, the
`audio-spatial` system driving voice + listener positions from `GlobalTransform`.
`panningModel` defaults `'HRTF'`; reuses the ADR-0168 distance fields. 2D path
unchanged; Null no-ops. **Listener orientation ✅** — the `audio-spatial` system
derives forward/up from the `AudioListener`'s `GlobalTransform` (pure
`listenerAxes`) and drives `setListenerOrientation` (modern `forwardX`/`upX`
params + `setOrientation` fallback), so 3D panning tracks camera rotation. Unit +
stub-context tested. **Source cones ✅** — `AudioSource.coneInnerAngle`/
`coneOuterAngle`/`coneOuterGain` (defaults `360`/`360`/`0` = omnidirectional) make a
3D source directional; `PannerConfig` carries them, `setSourceOrientation` drives
the panner's facing from the source's transform `-Z`. Unit + stub-context tested.

**Remaining:** Doppler (deprecated in Web Audio — likely skip), reverb
(`ConvolverNode` + IR asset), sidechain ducking. 3D spatial audio (position +
listener orientation + source cones) is otherwise complete.
