---
'@retro-engine/audio': minor
---

feat(audio): submix buses (bus → bus routing)

Audio mixer buses Phase 2 (ADR-0162). A bus can now route its output into another
bus instead of master, forming a submix tree:

```ts
audio.setBusOutput('dialogue', 'voice');
audio.setBusOutput('announcer', 'voice');
audio.setBusVolume('voice', 0.5); // ducks dialogue + announcer together
```

`Audio` owns the bus graph and rejects any routing that would form a cycle
(including a direct self-route), leaving the graph unchanged on rejection.
`busOutput(bus)` reads the current target (`''` = master). The HAL's
`configureBus(bus, output)` is a mechanical GainNode reconnect (`WebAudioBackend`
rewires the bus's one output edge; `NullAudioBackend` no-ops). Bus gains compose
multiplicatively down the chain.
