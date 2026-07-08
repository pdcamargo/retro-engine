---
'@retro-engine/audio': minor
---

feat(audio): convolution reverb bus effect (synthesized IR, no asset)

Adds a `reverb` `BusEffect` alongside `filter`/`compressor`:
`setBusEffect(bus, { kind: 'reverb', seconds?, decay?, wet? })`. The WebAudio
backend builds a `ConvolverNode` with a synthesized stereo impulse response — a
leading unit impulse (so the dry signal passes through) followed by a
decaying-noise tail — giving a self-contained wet/dry reverb in a single node,
with no IR asset required. Composes with submix routing exactly like the other
inserts; the null backend ignores it.
