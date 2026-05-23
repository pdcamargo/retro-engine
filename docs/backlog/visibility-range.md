# `VisibilityRange` — distance-based culling and LOD seed

- **Created:** 2026-05-23

## Context

ADR-0021 ships the three-component visibility pipeline (`Visibility` / `InheritedVisibility` / `ViewVisibility`) with frustum-and-layer culling. The renderer-roadmap Phase 3.6 calls for one more component the foundation didn't need: `VisibilityRange`.

`VisibilityRange` culls an entity by *distance from the camera*, independently of frustum and layers. Bevy's shape:

- A fade-in distance pair `[start_margin, fade_end]` — entity becomes visible past `start_margin` and fully visible at `fade_end`.
- A fade-out distance pair `[fade_start, end_margin]` — entity begins fading at `fade_start`, fully hidden past `end_margin`.
- A `use_aabb` flag — measure to the entity's AABB nearest-point instead of its origin.

It also seeds the LOD system: a mesh with multiple LOD levels picks the level whose `VisibilityRange` covers the current camera distance.

## Why deferred

- Not a precondition for any other Phase 3 work — Phase 6 (meshes) and Phase 8 (sprites) consume `ViewVisibility`, not `VisibilityRange`.
- The fade-band semantics introduce alpha-blending coupling that the engine doesn't have a pipeline for yet (no `Material` system; no `AlphaMode` plumbing). Shipping the data shape without a renderer that fades to it is half a feature.
- Distance-to-camera is a per-camera quantity, which makes `VisibilityRange` the first visibility component whose result is camera-dependent. ADR-0021 deliberately picked an aggregate-boolean `ViewVisibility`; supporting per-camera distance culling needs either (a) per-camera state on the entity or (b) a separate per-camera structure. That design call should land alongside the Phase 5 render-graph ADR, which has the same per-camera-state needs.
- LOD selection wants `VisibilityRange` to be the data source, not just a hide flag. Shipping the cull-only half locks us into a shape the LOD work may want to break.

## Acceptance

A follow-up ADR (or extension to ADR-0021) seals:

- The component shape (`VisibilityRange.startFadeIn`, `endFadeIn`, `startFadeOut`, `endFadeOut`, `useAabb`).
- How distance is measured — entity origin, AABB nearest point, AABB centre.
- How the per-camera result couples to `ViewVisibility` (extension field, parallel component, per-camera bitset, etc.).
- A fade-aware draw path (or an explicit "v1 is binary cull, fades come with materials") so the data shape doesn't ship before its renderer.
- LOD selection's relationship — `VisibilityRange` per LOD level, or a separate `Lod` component that references multiple ranges.

The component is registered in `packages/engine/src/visibility/` alongside the existing pipeline, with `CheckVisibility` extended to consume it, and at least one playground or example demonstrates a fade-out range visibly culling something.
