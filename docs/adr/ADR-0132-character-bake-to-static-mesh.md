# ADR-0132: Character bake to a static engine mesh

- **Status:** Accepted
- **Date:** 2026-06-27

## Context

The character creator (ADR-0131) composes morph targets onto a base mesh on the CPU at edit time.
"Bake" turns the current slider weights into a finished, shippable character. The roadmap framed the
bake output as a GLB that flows through the existing GLB/animation stack — but there is **no GLB
exporter** in `packages/gltf` today (only an importer), and writing one is a large, separate piece.

What the bake actually needs is a static mesh with the composed shape that renders now and, once
rigged (Phase 5), skins/animates like any other mesh.

## Decision

- **Bake produces a fresh static `Mesh`** via `bakeMorphedMesh(baseMesh, basePositions, contributions)`:
  compose the weighted targets onto the **pristine** base positions (not the live, possibly-morphed
  preview), copy the base's UVs + indices, recompute smooth normals. The result carries no morph data
  — an ordinary mesh with zero runtime morph cost that flows through the normal render (and future
  skinning/animation) stack.
- **v1 bakes to an in-memory `Mesh` asset** added to the `Meshes` store and spawned as a standalone
  entity (the baked character). This proves the full flow (compose → static mesh → render → riggable)
  through the real asset/render pipeline.
- **Disk persistence and GLB export are deferred**, tracked in `docs/backlog/`. The engine already has
  an `.rmesh` mesh serializer and the studio a project sink, so persisting the baked mesh to a project
  `.rmesh` (so it survives reload and is a first-class project asset) is a contained follow-up that
  reuses existing save infrastructure. A GLB exporter (for interchange/animation-stack parity) is the
  larger, separate piece the roadmap's "GLB" wording anticipated.

## Consequences

- The bake is real and usable immediately: a customized character becomes a static mesh entity that
  renders and is ready to rig — the headline Phase 3 outcome.
- An in-memory baked mesh does not survive a studio reload until the `.rmesh` persist follow-up lands;
  acceptable for the edit-time flow, tracked not lost.
- `bakeMorphedMesh` is engine-side and pure (unit-tested), so any consumer — the studio panel, a
  future preset builder, a headless pipeline — bakes the same way.
- The "GLB" in the roadmap is reinterpreted as "a static mesh through the engine stack." True GLB
  export remains a tracked want, not a Phase 3 blocker.

## Implementation

- `packages/engine/src/morph/morph-bake.ts` — `bakeMorphedMesh`.
- `apps/studio/src/panels-character-creator.ts` — the "Bake" button (compose at current weights →
  `Meshes.add` → spawn).
- Deferred: `docs/backlog/baked-character-persistence.md` (persist to `.rmesh`; GLB export).
