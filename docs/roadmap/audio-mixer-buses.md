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

## Phase 4 — spatial panning

Positional audio off the `AudioListener` transform: per-voice `PannerNode` (or a
cheaper stereo pan for 2D), distance attenuation model. Ties `AudioSource` +
`AudioListener` world transforms into the routing graph.
