# Backlog: opaque pipeline `@group(3)` prepass-read binding

## Why

ADR-0050 reserved `MaterialPipelineKey.prepassReadable?` for the opaque
pipeline's forward-compat path — when present, the opaque shader will
sample the prepass normal / motion-vector textures via a new
`@group(3)` bind group. The pipeline-key field participates in cache
keying so future variants are distinct, but the actual bind group
layout, per-camera bind-group population, and `setBindGroup(3, ...)`
on `OpaquePass3dNode` were deferred — there is no shader consumer of
the bindings in the ADR-0050 slice.

## Scope

- Add a `PrepassReadBindGroupCache` render-world resource keyed by
  `(sourceEntity, { normal, motionVector })` carrying the layout and
  the per-camera bind group.
- Build the layout per `(normal, motionVector)` combo: filtering
  sampler at `@binding(0)`, optional `texture_2d<f32>` for normal at
  `@binding(1)` (iff `normal`), optional `texture_2d<f32>` for motion
  vector at `@binding(2)` (iff `motionVector`).
- `MaterialPluginState.specializeOpaque`: append the layout to the
  pipeline layout when `ctx.key.prepassReadable` is set.
- `MaterialPlugin`'s queue: choose the `prepassReadable` flag set per
  camera from the camera's enabled `PrepassFlagsByCamera` entry,
  request the matching pipeline variant, populate the per-camera bind
  group from `ViewPrepassTargets`.
- `OpaquePass3dNode`: `setBindGroup(3, …)` when an entry exists for
  the active camera.

## Done definition

The first consumer (likely TAA in Phase 12.6) lands together with
this binding. Until then, the binding ships uninhabited — better to
land the layout + bind-group lifecycle with its consumer than to
maintain dead bindings.
