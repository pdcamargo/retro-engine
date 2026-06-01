# `StandardMaterial`: `doubleSided` + `normalScale`

- **Created:** 2026-06-01
- **Decision:** ADR-0057

## Context

`StandardMaterial` cannot express two core glTF material fields: `doubleSided` (cull control) and
normal-map `scale`. Importing without them is visibly wrong — single-sided geometry (foliage, cards,
glass) disappears from one side, and normal-map strength is forced to 1. ADR-0057 chose to extend the
shipped material now so glTF imports render correctly out of the box.

## Why deferred

It edits a shipped package (`StandardMaterial`, governed by ADR-0028) and the PBR shader, and depends
on per-material cull being expressible in the pipeline — so it is isolated as its own independently
shippable slice (own changeset) rather than buried in the glTF material-mapping work.

## Acceptance

- `StandardMaterial` (`packages/engine/src/material/standard-material.ts`) gains a `normalScale`
  (default 1) and a `doubleSided` (default false) field; additive, no breaking change.
- `pbr.wgsl` multiplies the sampled tangent-space normal by `normalScale`; `doubleSided` selects the
  cull mode for the material's pipeline (verify per-material cull is expressible — if the pipeline cull
  state is not yet per-material, that plumbing is part of this slice).
- A render/unit test covers a double-sided material (back faces visible) and a non-unit `normalScale`.
- Lint, typecheck, test, build, bench green; changeset added.
