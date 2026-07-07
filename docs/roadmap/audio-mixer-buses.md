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

## Phase 3 — bus effect inserts

An effect chain on a bus (low-pass filter, compressor/limiter, reverb send). Needs
a small effect-node abstraction over Web Audio's `BiquadFilterNode` /
`DynamicsCompressorNode` / `ConvolverNode`, capability-described so the Null
backend no-ops. This is where "duck music under dialogue" (sidechain) would land.

## Phase 4 — spatial panning

Positional audio off the `AudioListener` transform: per-voice `PannerNode` (or a
cheaper stereo pan for 2D), distance attenuation model. Ties `AudioSource` +
`AudioListener` world transforms into the routing graph.
