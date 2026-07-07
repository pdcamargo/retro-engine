# ADR-0164: Audio bus effect inserts

- **Status:** Accepted
- **Date:** 2026-07-07
- **Extends:** ADR-0159 (mixer buses), ADR-0162 (submix buses) — both sealed

## Context

Buses had a linear gain and submix routing (bus → bus → master), but no way to
**process** a bus: muffle everything on a bus with a low-pass filter (pausing,
underwater), or glue a submix with a compressor. Web Audio provides these as
nodes (`BiquadFilterNode`, `DynamicsCompressorNode`) that sit inline in a chain
(confirmed against MDN, per §2). The questions: how an effect is described so it
crosses the HAL (and a headless backend can ignore it), and how the insert
composes with the existing `gain → output` (submix) wiring without the two
rebuilds fighting.

## Decision

A **described effect** inserted between a bus's gain and its output, with the
backend owning one chain-rebuild routine.

- **`BusEffect` (a plain data spec)** — `{ kind: 'filter', type, frequency, q? }`
  or `{ kind: 'compressor', threshold?/knee?/ratio?/attack?/release? }`. Data, not
  a live node, so it crosses the HAL, is inspectable, and a headless backend
  drops it. One effect per bus (not a chain) this phase — enough for the common
  cases; a chain is a later extension.
- **HAL `setBusEffect(bus, effect | null)`** — install or clear. `WebAudioBackend`
  builds the concrete node (`makeEffect`), and both `setBusEffect` and
  `configureBus` funnel through **one private `rebuildBus(name)`** that wires
  `gain → [effect] → output` (output = the bus's target bus, or master). Because
  a bus has exactly one output edge, rebuild = `disconnect()` + re-add; voices
  feed the gain as inputs and are untouched. The backend tracks per-bus
  `busOutputs` + `busEffects` so a reroute preserves the effect and an effect
  change preserves the route — the two compose instead of clobbering.
- **`NullAudioBackend` ignores it** (no graph, no sound), matching the rest of the
  HAL's headless parity.
- **`Audio` facade** forwards `setBusEffect` and tracks the spec for a
  `busEffect(bus)` query, mirroring how it tracks the submix graph — the facade
  is the inspectable source of truth, the backend does the audio.

## Consequences

- `audio.setBusEffect('music', { kind: 'filter', type: 'lowpass', frequency: 800 })`
  muffles the music bus; `null` removes it. A compressor on a submix bus tames its
  combined peaks.
- Effects and submix routing compose: rerouting a bus that has an effect keeps
  `gain → effect → newTarget`; both go through `rebuildBus`, so there is one place
  the chain shape is defined and no ordering hazard between the two operations.
- The spec being data (not nodes) keeps the HAL backend-agnostic and leaves room
  to serialize an authored bus effect later.
- **Deferred:** multi-effect chains per bus, per-effect live parameter automation,
  and spatial panning (ADR-0159/0162 deferred list). A bus still has at most one
  effect + a linear gain.

## Implementation

- `packages/audio/src/audio-backend.ts` — `BusEffect` type; `setBusEffect` on the HAL.
- `packages/audio/src/web-audio-backend.ts` — `busOutputs`/`busEffects` maps,
  `rebuildBus`, `makeEffect`; `configureBus` routes through `rebuildBus`.
- `packages/audio/src/null-audio-backend.ts` — no-op `setBusEffect`.
- `packages/audio/src/audio-resource.ts` — `setBusEffect` / `busEffect` + spec map.
