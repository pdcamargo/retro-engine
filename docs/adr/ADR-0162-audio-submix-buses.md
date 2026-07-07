# ADR-0162: Audio submix buses (bus → bus routing)

- **Status:** Accepted
- **Date:** 2026-07-06
- **Extends:** ADR-0159 (audio mixer buses — sealed)

## Context

ADR-0159 shipped flat mixer buses: every bus routes straight to master
(`voice.gain → bus → master`). Real mixing wants **submix trees** — e.g.
`dialogue` and `announcer` both feed a `voice` submix, and lowering `voice`
ducks both at once while music is untouched. Web Audio makes this trivial in the
graph (a bus `GainNode` can connect to another bus `GainNode` instead of master),
but two things need deciding: the API to set a bus's output, and where the
**acyclic** invariant is enforced (a bus routed into its own descendant would
feed back).

## Decision

A bus can route its output into another bus, and the acyclic invariant lives in
the `Audio` resource, not the backend.

- **HAL: `configureBus(bus, output)`** — mechanical reconnect only. The backend
  rewires the bus `GainNode` to the target bus (or master when `output === ''`),
  creating either bus on demand. `WebAudioBackend` `disconnect()`s the bus's one
  output edge and reconnects to the target — voices feed the bus as *inputs*, so
  they are unaffected. `NullAudioBackend` no-ops (no graph, no sound).
- **`Audio.setBusOutput(bus, output)` owns the graph.** The resource holds a
  `Map<bus, output>` (absent = master), **rejects a routing that would form a
  cycle** (throws, leaving the graph unchanged — including a direct self-route),
  then calls `backend.configureBus`. `Audio.busOutput(bus)` reads it back
  (`''` = master). Cycle detection walks the output chain from the proposed
  target; if it reaches `bus`, the edge is refused.
- **Why the graph lives in the facade, not the backend.** The cycle check is
  pure bookkeeping identical for every backend; centralizing it means one
  implementation, headless parity (the `Null` backend enforces the same invariant
  because the facade does), and a backend contract that stays a dumb reconnect.
  It mirrors ADR-0159's split (the facade forwards; the backend does the audio).

## Consequences

- `audio.setBusOutput('dialogue', 'voice')` builds a submix; setting the `voice`
  bus volume then scales `dialogue` (and any other child) together.
- Cycles are impossible to author — the guard is at the single `setBusOutput`
  entry point, so no backend can be driven into a feedback loop.
- Bus gains still compose multiplicatively down the chain
  (`voice.gain → dialogue-bus → voice-bus → master`), so a per-submix duck and a
  master fade stack correctly.
- **Deferred (unchanged from ADR-0159):** effect inserts on a bus
  (filter / compressor / reverb send) and spatial panning. A submix bus still
  carries only a linear gain.

## Implementation

- `packages/audio/src/audio-backend.ts` — `configureBus(bus, output)` on the HAL.
- `packages/audio/src/web-audio-backend.ts` — reconnect the bus `GainNode`.
- `packages/audio/src/null-audio-backend.ts` — no-op `configureBus`.
- `packages/audio/src/audio-resource.ts` — `busGraph`, `setBusOutput`,
  `busOutput`, and the cycle guard.
