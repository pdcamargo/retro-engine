# Engine Time Resource

- **Created:** 2026-05-21

## Context

The engine's frame loop calls `requestAnimationFrame(tick)` but captures no delta and exposes no notion of elapsed time. Any system that wants to animate, count down, or pace logic has no idiomatic way to read "how long since the last frame."

This backlog item adds a **`Time` resource** as the first real consumer of the resource registry. Bevy distinguishes three time sources — `Time<Virtual>` (pausable, scalable, the default for gameplay), `Time<Real>` (wall-clock, for cutscenes and audio sync), `Time<Fixed>` (fixed-timestep accumulator) — and lets systems pick which they consume. We adopt the Virtual vs Real distinction from day 1; `Time<Fixed>` lands with the fixed sub-loop in the schedule-and-states backlog item.

```ts
// Approximate surface.
class Time {
  readonly virtual: TimeClock; // delta, elapsed, scale, paused
  readonly real:    TimeClock; // delta, elapsed (never paused, never scaled)
  readonly frame:   number;    // monotonic frame counter
}

app.addSystem('update', [Res(Time)], (time) => {
  if (!time.virtual.paused) sprite.x += speed * time.virtual.delta;
});
```

Engine populates the resource in the `First` stage of each frame from the rAF callback's `timeOrigin + DOMHighResTimeStamp`. The Virtual clock respects pause and time scale; the Real clock does not. Frame counter increments unconditionally.

## Why deferred

M2 phase 3. Depends on the resource registry (phase 2) existing to host the resource, and on the system param protocol (phase 1) so systems can declare `Res<Time>`. It's a small piece, but it's the first end-to-end exercise of the registry + param plumbing, so it pulls forward integration risk.

## Acceptance

- `packages/engine` exposes a `Time` class with `virtual`, `real`, and `frame` properties matching the surface above.
- `App` auto-registers a `Time` resource on construction; no manual `insertResource(new Time())` required.
- Engine populates Time in the `First` stage every frame; delta is the gap between consecutive rAF timestamps, clamped to a reasonable upper bound (e.g., 100 ms) to survive tab-resume.
- Pausing (`time.virtual.paused = true`) freezes `virtual.delta` to 0 and stops `virtual.elapsed` advancing; `real` continues.
- Scaling (`time.virtual.scale = 0.5`) halves `virtual.delta`.
- Tests cover: delta is positive across two frames; pause freezes virtual; scale affects virtual but not real; frame counter monotonically increases.
- No mention of threading, web workers, or any off-main-thread time source.

## Links

- Roadmap: `docs/roadmap/engine-foundations.md` (M2 umbrella, phase 3)
- Prereqs: `docs/backlog/system-param-protocol.md`, `docs/backlog/engine-resource-registry.md`
- Follow-up: `Time<Fixed>` ships with `docs/backlog/engine-schedule-and-states.md`
- External: Bevy `Time<Virtual>` / `Time<Real>` / `Time<Fixed>` ([docs.rs/bevy/time](https://docs.rs/bevy/latest/bevy/time/struct.Time.html))
