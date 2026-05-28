# Backlog: prepass motion vectors

## Why

ADR-0050 shipped the screen-space prepass family for the depth and
normal channels, with the previous-frame transform substrate already in
place (`PreviousGlobalTransform` component, `'first'`-stage propagation
system, `ViewPreviousFrame` view-proj cache, view uniform's
`prev_view_proj` slot, `MotionVectorPrepass` marker component). The
per-entity previous-instance vertex buffer machinery — and the
`vs_prepass` / `fs_prepass_motion` shader stages that consume it —
remained deferred. This slice closes that gap.

## Scope

- Add `PREVIOUS_INSTANCE_LAYOUT` to `material/instance-layout.ts`,
  binding `@location(16..19)` for the previous-frame model matrix.
- Add a sibling `MeshInstanceBuffer` to `MaterialPluginState`
  (lazy-allocated; only populated when at least one camera has
  `MotionVectorPrepass`). The packer writes previous matrices in
  step with the current instance buffer so a single
  `firstInstance + count` slice indexes both.
- Extract path: read `PreviousGlobalTransform.matrix` per renderable
  alongside `GlobalTransform.matrix`; pack into the sibling buffer.
- `pbr.wgsl`: add `vs_prepass_motion` variant that produces both
  `curr_clip` and `prev_clip` (the previous-instance attributes feed
  the latter, multiplied by `view.prev_view_proj`); add
  `fs_prepass_motion` writing the half-NDC delta via
  `compute_motion_vector`.
- `specializePrepass`: wire the second vertex buffer in
  `vertex.buffers` when `flags.motionVector`; add an `rg16float`
  fragment output.
- `ViewPrepassTargets`: allocate the `rg16float` motion-vector target
  when the marker is present.
- Drop the deferred warning in `PrepassPlugin`'s Extract; let the
  motion-vector flag flow through `PrepassFlagsByCamera`.
- `StandardMaterial.prepassWrites()` returns `motionVector: true`.
- Tests: first-frame zero-motion (substrate already guarantees this);
  second-frame nonzero motion after a translation mutation.

## Done definition

- `bun run lint`, `typecheck`, `test`, `build` all green.
- One new bench for the prepass node at ~1000 PBR meshes (defer
  baseline-update commit until landing).
- ADR-0050's "Deferred to the next slice" line item lifts; this
  backlog file is deleted (only after explicit user confirmation per
  CLAUDE.md §3).
