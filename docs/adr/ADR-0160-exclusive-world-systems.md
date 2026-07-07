# ADR-0160: Exclusive `world()` systems

- **Status:** Accepted
- **Date:** 2026-07-06
- **Extends:** ADR-0006 (system param protocol), ADR-0009 (commands buffer) — both sealed

## Context

Every gameplay system so far makes structural changes (spawn / despawn / insert /
remove) through `Commands` (ADR-0009): the changes are **buffered** and flushed
after the system returns. That is the right default — it keeps a system's world
view stable while it iterates queries. But some work genuinely needs the change
to take effect **immediately, mid-system**, and to read it back:

- Complex spawn logic that spawns an entity and then queries/relates it in the
  same pass.
- One-shot setup and tooling that would rather script the world directly than
  thread everything through deferred commands.

Bevy models this as an **exclusive system** taking `&mut World`: it runs with
unaliased access to the whole world and mutates it in place. Retro Engine's
runner is already single-threaded, so "runs alone" costs nothing to guarantee —
what is missing is a param that hands a system the live `World` and the guardrail
that such a system takes nothing else. This is the "exclusive systems" phase of
the ECS ordering-depth roadmap item.

## Decision

Add a **`world()` system param** that resolves to the stage's live `World`.

- **`world(): Param<World>`** — resolves to `ctx.world` (the main world for main
  stages; the render world in the `'render'` stage). The system receives the real
  `World` and calls its structural API (`spawn`, `despawn`, `insertBundle`,
  `removeComponent`) directly; changes are visible immediately, including to
  later systems in the same frame.
- **Exclusivity guardrail.** The `Param` protocol gains an optional
  `exclusive?: boolean` flag; `world()` sets it. `App.addSystem` /
  `App.addSystems` throw at registration if a system carries an exclusive param
  **and** any other param — an exclusive system holds the entire world, so any
  second param would alias it. This matches Bevy's rule and keeps the door open
  for a future parallel scheduler without an API change.
- **Naming.** The param factory is lowercase `world()`, matching the existing
  lowercase source/param factories (`key`, `mouseButton`, `gamepadAxis`) and
  sidestepping a collision with the `World` **class** (PascalCase). Value and
  type live in separate namespaces, so `const w = world()` typed `World` reads
  cleanly.
- **Change detection & commands.** No special handling: the runner already
  captures each system's change tick before it runs and flushes its command
  buffer after, and `World`'s structural ops bump the change tick. An exclusive
  system simply mutates in place at its scheduled point; its edits are seen by
  later systems exactly as flushed commands would be. It does not use `Commands`,
  so its (empty) command buffer flush is a no-op.

## Consequences

- `app.addSystem('startup', [world()], (w) => { const e = w.spawn(...); w.insertBundle(e, ...) })`
  performs immediate structural setup with read-back, without deferring through
  `Commands`.
- The guardrail turns a real footgun (an exclusive system that also asks for a
  `Query`/`Res`, which would alias the world under future parallelism) into a
  registration-time error with a clear message.
- `Commands` remains the default for gameplay; `world()` is the deliberate
  escape hatch, not the norm — the deferred model still keeps most systems'
  world view stable during iteration.
- Because the runner is single-threaded, no scheduling change is needed today;
  the `exclusive` flag is the seam a parallel scheduler would later read to run
  such systems alone.

## Implementation

- `packages/engine/src/system-param.ts` — `Param.exclusive`; the `world()` factory.
- `packages/engine/src/index.ts` — exclusivity validation in `registerSystem`
  (shared by `addSystem` / `addSystems`); `world` re-exported.
