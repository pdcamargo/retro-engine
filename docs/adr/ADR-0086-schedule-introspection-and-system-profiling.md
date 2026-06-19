# ADR-0086: Schedule introspection, system identity & runtime profiling

- **Status:** Accepted
- **Date:** 2026-06-18

## Context

The studio's Systems panel needs to show the live schedule: which systems are
registered, in what order, where they came from, whether they're running, and
how long each takes. The runtime had none of that exposed. A `RegisteredSystem`
carried only `id`, `params`, `fn`, and ordering metadata (`label`/`before`/
`after`/`set`); the per-stage `StageSystems` collections were private to `App`;
there was no display name, no notion of which plugin registered a system, no way
to disable a system at runtime, and no timing.

Systems also had no human-facing identity. `label` is an ordering token (free-form,
non-unique, optional) and the function name is unreliable (arrow functions, minification).
And there was no way for tooling to distinguish engine framework systems from
editor tooling systems from application gameplay systems.

## Decision

Add four runtime capabilities to `App`, all opt-in or zero-cost when unused:

1. **System identity.** Every `RegisteredSystem` gains a resolved `name`
   (`AddSystemOptions.name` → `label` → `fn.name` → `system #<id>`), an `origin`
   bucket (`'engine' | 'editor' | 'user'`), and the `originPlugin` that registered it.

2. **Origin attribution.** `App` maintains a plugin build stack (pushed around
   each `plugin.build()`), so every `addSystem` call is attributed to its
   registering plugin automatically. The origin bucket resolves from an explicit
   `AddSystemOptions.origin`, else the nearest plugin on the build stack that
   declares `PluginObject.category()`, else `'user'`. A parent plugin's category
   is inherited by the sub-plugins it adds, so tagging `CorePlugin` as `'engine'`
   classifies everything it spawns. Systems registered directly on the App fall
   to `AppOptions.defaultSystemOrigin` (default `'user'`); an editor host sets it
   to `'editor'` so its scaffolding buckets correctly without tagging each call.

3. **Enable / disable.** `App.setSystemEnabled(id, enabled)` toggles a system; the
   stage runner and render-set runner skip disabled systems before resolving
   params. A power tool for tooling — disabling engine systems is allowed and can
   break the App; gameplay gating still belongs to `runIf`.

4. **Gated profiling + introspection.** `AppOptions.profileSystems` (default
   `false`) inserts a `SystemProfiler` resource and wraps each system run with a
   `performance.now()` delta folded into a rolling average. `App.describeSchedule()`
   returns a per-stage, execution-ordered snapshot of `SystemInfo` (identity,
   origin, enabled state, run-condition flag, and timings when profiling is on).

## Consequences

- The studio can render the real schedule grouped by origin and plugin, with live
  per-system cost and working toggles, replacing the stubbed `SystemRow` data.
- Profiling costs roughly 2× per-system runner overhead when on (two timestamps +
  a map write); ~10µs/frame at 256 systems — negligible for an editor, and zero
  when off (one boolean check per stage). Tracked by `bench/schedule.bench.ts`.
- Engine plugins must declare `category()` to be bucketed as `'engine'`; an
  untagged plugin's systems fall to `'user'`. The inheritance-down-the-build-stack
  rule keeps this to a handful of tags rather than one per plugin.
- `describeSchedule()` allocates a fresh snapshot per call; fine at editor cadence,
  not intended for per-frame gameplay use.

## Implementation

- `packages/engine/src/schedule.ts` — `SystemOrigin`, `RegisteredSystem` (`name`/`origin`/`originPlugin`), `runStage` (disable + profile)
- `packages/engine/src/schedule-info.ts` — `SystemInfo`, `StageGroup`
- `packages/engine/src/system-profiler.ts` — `SystemProfiler`, `SystemTiming`
- `packages/engine/src/index.ts` — `AppOptions.profileSystems`/`defaultSystemOrigin`, `AddSystemOptions.name`/`origin`, `App.setSystemEnabled`/`isSystemEnabled`/`describeSchedule`, plugin build stack, `runRenderSet` (disable + profile)
- `packages/engine/src/plugin.ts` — `PluginObject.category`
- `packages/engine/src/core-plugin.ts`, `material/material-plugin.ts`, `material/standard-material.ts`, `prepass/prepass-plugin.ts`, `light3d/light-3d-plugin.ts`, `grid/grid-plugin.ts`, `asset/asset-plugin.ts`, `scene/scene-plugin.ts` — `category(): 'engine'`
- `packages/gltf/src/gltf-plugin.ts` — `category(): 'engine'`
- `packages/engine/bench/schedule.bench.ts` — runner overhead, profiling on vs off
