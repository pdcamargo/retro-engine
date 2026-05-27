# ADR-0043: Phase 9.5 — normal-map-aware 2D lighting

- **Status:** Accepted
- **Date:** 2026-05-27

## Context

The final Phase 9 item (roadmap §9.5, marked *optional*) is per-pixel
normal-mapped 2D lighting: a sprite carries a tangent-space normal map, and
point / spot / directional lights shade it by `N·L`. This builds on
[ADR-0037](ADR-0037-point-light-2d.md) (accumulation/composite),
[ADR-0041](ADR-0041-2d-light-kinds-and-composite-modes.md) (light kinds), and
[ADR-0042](ADR-0042-2d-shadow-occluders.md) (shadows). It **extends** ADR-0037 —
no sealed decision is replaced.

The roadmap called this "capability-checked", but normal mapping needs only a
second texture bind (universally available); there is no relevant
`RendererCapabilities` flag. So it is an **engine-level opt-in**
(`Light2dSettings.normalMapping`), not a hardware gate.

**Normal buffer production — prepass, not MRT.** The accumulation pass needs a
per-pixel surface normal. The obvious route — have the geometry passes write a
second MRT attachment — was rejected: a render pass has a fixed attachment
count, so it would force *every* pipeline drawing into the Core2d opaque /
transparent passes — including **user-authored `Material2d` shaders** — to
output a normal at `@location(1)`, breaking the `Material2d` single-target
contract. Instead, normal-mapped sprites are re-drawn into a dedicated normal
G-buffer by a prepass. This also keeps accumulation *before* the color geometry
passes (the normal buffer is produced by its own prepass, not by the geometry
passes), so **ADR-0037 decision 5 (pass order) is preserved** — no supersession.

## Decision

1. **`Sprite.normalMap?: ImageHandle`.** Optional tangent-space normal map,
   sampled with the sprite's UVs. No effect unless `Light2dSettings.normalMapping`
   is enabled.

2. **A separate normal prepass captures normal-mapped sprites.** The light2d
   module owns the capture (`Light2dNormalState`): it re-queries visible
   normal-mapped sprites and packs them with the sprite renderer's own
   `packSpriteInstance` into a dedicated instance buffer, then a
   `Light2dNormalPrepass2dNode` draws each (one instanced draw per sprite, bound
   to its normal map) into the per-camera normal buffer. The normal pipeline
   reuses `SpritePipeline`'s compiled vertex module (`vs_main`), pipeline layout,
   and quad buffers, plus a new `fs_normal` entry point in the sprite WGSL that
   decodes the normal map and writes the (re-encoded) world normal. This is a
   deliberate intra-engine reuse of the sprite renderer's geometry — sprites
   stay ignorant of lighting (they only gain the optional field + the shader
   variant); `Material2d` is untouched.

3. **Per-camera normal G-buffer.** `ViewLight2dTargets` gains a `normalTex` /
   `normalView` (`rgba8unorm`), allocated alongside baseColor / lightAccum and
   cleared each frame to the flat encoded normal `(0,0,1)` — so un-mapped
   surfaces face the viewer and are lit by an overhead light. The buffer is
   per-camera (screen-space); the prepass runs per camera through that camera's
   view.

4. **Accumulation shades by `N·L` when enabled.** The accumulation pipeline
   gains `@group(2)` = normal texture + sampler + an `(enabled, height)`
   uniform. Sampling is done in uniform control flow; point / spot / directional
   fragments multiply their contribution by `max(0, dot(N, L))`, where
   `L = normalize((lightXY − fragXY, height))` for point / spot and
   `normalize((−travelDir, height))` for directional. Ambient zones stay
   omnidirectional (no `N·L`). `enabled` mirrors `Light2dSettings.normalMapping`;
   `height` is `Light2dSettings.normalLightHeight` (default 64) — the world-space
   elevation of 2D lights above the sprite plane.

5. **The sprite-independent accumulation inputs stay sprite-independent.** The
   normal sampler + uniform (`@group(2)` bindings 1–2) are created without the
   sprite pipeline, so `Light2dPlugin` works with no `SpritePlugin` installed —
   the normal buffer simply stays flat and lighting behaves as before. Only the
   capture *pipeline* needs the sprite module.

6. **Pass order: the prepass is prepended.** New Core2d chain:
   `Light2dNormalPrepass2d → Light2dShadowPass2d → Light2dAccumulationPass2d →
   OpaquePass2d → TransparentPass2d → Light2dCompositePass2d`. Accumulation still
   precedes the geometry passes (ADR-0037 decision 5 intact).

7. **v1 scope.** Sprite rotation is not applied to normals (tangent space is
   treated as world space); a single global light height (not per-light); only
   sprites carry normal maps (not `Material2d` / mesh geometry).

Composition-only. `Light2dNormalState` is a render-world resource; the prepass
is a graph node + a capture system; the sprite gains a field + a shader entry
point.

## Consequences

**Easier:**

- 2D sprites get per-pixel normal-mapped lighting from point / spot / directional
  lights, composing with shadows from ADR-0042.
- `Material2d`'s single-target contract is untouched — custom 2D materials need
  no normal output.
- No sealed ADR is superseded; no GPU capability is required.
- Lighting still works with no sprites installed (flat normal buffer).

**Harder / accepted trade-offs:**

- **Normal-mapped sprites are drawn an extra time** (once for color, once into
  the normal buffer). Only sprites carrying a normal map pay this; the prepass
  re-packs just those.
- **One global light height**, not per-light — a scene-wide knob. Per-light
  height is deferred.
- **Sprite rotation is ignored** for normals (tangent ≈ world). Rotated
  normal-mapped sprites shade as if unrotated; acceptable for v1, documented.
- **Enabling normal mapping shades all sprites by `N·L`** (un-mapped ones via the
  flat normal), which dims grazing angles — `normalLightHeight` tunes this. It is
  a global toggle by design.
- **Shader correctness is browser-verified, not headless** — the bun tests cover
  the CPU surface (capture, draw recording, node order, target + bind-group
  allocation, the opt-in flag); the `N·L` math is validated in the playground
  (`?mode=lights&normals=1`).

## Not yet done

- **Per-light height** (instead of one global value).
- **Sprite rotation applied to sampled normals** (tangent → world basis).
- **`Material2d` / mesh normal output** — only sprites carry normal maps today.
- **Tangent / bitangent maps** for full TBN; v1 assumes axis-aligned tangent
  space.

## Implementation

- `packages/engine/src/sprite/sprite.ts` — `Sprite.normalMap` + `SpriteOptions.normalMap`.
- `packages/engine/src/sprite/sprite.wgsl.ts` — `fs_normal` entry point.
- `packages/engine/src/light2d/light-2d-normal.ts` — `Light2dNormalState` (capture pipeline, instance buffer, per-draw list, `(enabled, height)` uniform), `LIGHT2D_NORMAL_FORMAT`, `LIGHT2D_DEFAULT_LIGHT_HEIGHT`.
- `packages/engine/src/render-graph/light2d-normal-prepass-2d-node.ts` — `Light2dNormalPrepass2dNode`, `Light2dNormalPrepass2dLabel`.
- `packages/engine/src/light2d/light-2d-targets.ts` — per-camera `normalTex` / `normalView` + `normalAccumBindGroup`.
- `packages/engine/src/light2d/light-2d-pipeline.ts` — accumulation `@group(2)` normal layout + `buildNormalAccumBindGroup`.
- `packages/engine/src/light2d/light-2d-accumulation.wgsl.ts` — `N·L` term sampling the normal G-buffer.
- `packages/engine/src/light2d/light-2d-settings.ts` — `normalMapping`, `normalLightHeight`.
- `packages/engine/src/light2d/light-2d-plugin.ts` — inserts `Light2dNormalState`, the normal prepass node + edge, and the `light2d-capture-normals` system.
- `packages/engine/src/light2d/index.ts`, `packages/engine/src/render-graph/index.ts`, `packages/engine/src/index.ts` — re-exports.
- `packages/engine/src/light2d/light-2d-normal.test.ts` — node order, target + bind-group allocation, capture on/off.
- `apps/playground/src/lights-showcase-plugin.ts` — a procedural bump-mapped sprite + `?normals=1` opt-in.
