---
'@retro-engine/audio': minor
---

feat(audio): bus effect inserts (filter / compressor)

Audio mixer buses Phase 3 (ADR-0164). `Audio.setBusEffect(bus, effect | null)`
inserts a described effect between a bus's gain and its output:

```ts
audio.setBusEffect('music', { kind: 'filter', type: 'lowpass', frequency: 700 }); // muffle
audio.setBusEffect('voice', { kind: 'compressor', ratio: 8 });                    // glue a submix
audio.setBusEffect('music', null);                                                // remove
```

A `BusEffect` is plain data (`filter` → `BiquadFilterNode`, `compressor` →
`DynamicsCompressorNode`), so it crosses the HAL and a headless backend drops it.
`WebAudioBackend` funnels both effect changes and submix reroutes through one
`rebuildBus`, so an effect survives a `setBusOutput` and vice-versa
(`gain → effect → target`). `Audio.busEffect(bus)` reads the current spec.
