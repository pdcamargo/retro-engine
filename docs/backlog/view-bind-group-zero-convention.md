# View bind group `@group(0)` convention

- **Created:** 2026-05-23

## Context

ADR-0020 ships per-camera view uniforms and exposes the per-camera `BindGroup` to render systems via `ctx.camera.viewBindGroup`. The engine does **not** pre-bind it on the pass — render systems that want view data set it themselves. The Bevy convention is that all material/mesh pipelines lay out `@group(0) @binding(0) var<uniform> view: ViewUniform` and the engine auto-binds. We'd like to land that convention here, but Phase 2 has no concrete consumer that benefits.

Concretely: today a user writing a custom shader pipeline that samples view data has to:
1. Fetch the layout from `ViewBindGroupCache.layout` (or a future helper).
2. Declare their `pipelineLayout` with `[viewLayout, ...own layouts]`.
3. Call `ctx.pass.setBindGroup(0, ctx.camera.viewBindGroup)` themselves.

We want step 3 to disappear — and ideally step 1 should be expressible declaratively at pipeline-build time.

## Why deferred

- The `@group(0) = view` convention only pays its way once there's a `Material` trait + pipeline-builder that bakes the layout in (renderer-roadmap Phase 7). Pinning it in Phase 2 forces the playground triangle to renumber its color uniform to `@group(1)` for no concrete benefit, and the convention has no enforcer.
- Validation behaviour for "pipeline layout doesn't declare a group, but a bind group is set there" depends on WebGPU's spec interpretation and may differ between backends. Worth landing alongside concrete materials so we can verify against real shaders.
- Phase 7's `AsBindGroup` equivalent (ADR-level, open question in `docs/roadmap/renderer.md`) will likely have something to say about group-index defaults.

## Acceptance

A new ADR is sealed that pins the convention, and:

- `CameraPlugin` (or a follow-up `MaterialPlugin`) pre-binds `ctx.camera.viewBindGroup` at `@group(0)` on every per-camera pass before any Render-set system runs.
- A public helper (e.g. `getViewBindGroupLayout(app): BindGroupLayout`) exists for user pipelines and is exercised by at least one material in `packages/engine` (the unlit material under Phase 7.7 is the natural first consumer).
- The playground triangle (or its replacement) demonstrates the convention end-to-end — view data sampled in a real WGSL shader, pipeline layout declaring `[viewLayout, ...]`, no manual `setBindGroup(0, ...)` call.
- The ADR also addresses what happens when a pipeline does not declare `@group(0)` — silent skip vs. validation error vs. engine-side no-op rebind.
