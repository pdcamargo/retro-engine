# Skinned-mesh frustum bounds from joints

- **Created:** 2026-07-08

## Context

`calculateBounds` computes an entity's frustum-culling `Aabb` from `mesh.computeAabb()`
— the mesh's **bind-pose** bounds. A skinned mesh deforms with its skeleton beyond
that box (animation, or a rig whose skeleton scale differs from the mesh), so
frustum-testing the bind box can wrongly cull a posed character.

ADR-0173 shipped the safe interim fix: entities with a `Skeleton` **skip** the
frustum test (treated like `NoFrustumCulling`) in `checkVisibilitySystem`. Correct,
but conservative — skinned meshes are never frustum-culled, so a scene with many
characters draws all of them regardless of camera.

## Wanted

Compute a proper world-space bound for skinned meshes from the **posed skeleton**
(union of joint world positions, expanded by a per-joint or mesh-derived radius),
recomputed when the pose changes, and frustum-test that instead of skipping. Mirrors
Bevy's skinned-mesh AABB handling. Then remove the skip in `check-visibility.ts`.

_Links:_ `packages/engine/src/visibility/check-visibility.ts`, `packages/engine/src/mesh/calculate-bounds.ts`, [ADR-0173](../adr/ADR-0173-web-game-runtime-baseline-and-scene-loading.md)
