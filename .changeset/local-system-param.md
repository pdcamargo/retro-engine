---
'@retro-engine/engine': minor
---

feat(engine): `Local<T>` system param — per-system persistent state

Adds the `Local` system param (P1 system-param sugar): per-system persistent
state for accumulators, frame counters, and system-private caches, matching
Bevy's `Local<T>`.

- `Local(factory)` declares a param whose value lives in a `LocalState<T>`
  (`.current`). It is lazily seeded from `factory` on the system's first run,
  then the same slot is handed back every subsequent run, so writes to `.current`
  persist across frames.
- Each `Local(...)` call owns a distinct slot, so two systems declaring
  `Local(() => 0)` never share state.

Unit-tested: lazy factory seeding + write persistence across frames, per-system
isolation, and a non-primitive (array) slot growing across frames.
