---
'@retro-engine/audio': minor
---

feat(audio): mixer buses — named groups with per-bus volume

First slice of audio mixer buses (ADR-0159). Voices can route through a named bus
(`music`, `sfx`, `ui`, …) whose volume scales every voice on it, independent of
per-voice and master gain:

```ts
cmd.spawn(new AudioSource(musicHandle, { loop: true, bus: 'music' }));
app.addSystem('update', [ResMut(Audio)], (audio) => audio.setBusVolume('music', 0.3));
```

- `PlayOptions.bus` routes a voice; omitted goes straight to master (unchanged).
- `Audio.setBusVolume(bus, volume)` / `busVolume(bus)` — per-bus linear gain.
- `AudioSource.bus` (authored, serialized) declares an entity's bus.
- `WebAudioBackend` inserts a `GainNode` per bus (`voice.gain → bus → master`);
  `NullAudioBackend` round-trips bus volumes headlessly. Buses are string-keyed
  and created on first use.

Bus-to-bus submix trees, effect inserts, and spatial panning are tracked
follow-ups.
