---
'@retro-engine/engine': minor
---

feat(engine): 2D light kinds (spot/directional/ambient) + composite modes — Phase 9.1/9.3

Completes roadmap §9.1 (the remaining 2D light components) and §9.3 (the `add` / `screen` composite modes) on top of [ADR-0037](../docs/adr/ADR-0037-point-light-2d.md)'s accumulation/composite foundation. Per ADR-0041. Every light kind shares one instance buffer and resolves in a single instanced accumulation draw — a per-instance `kind` discriminator selects geometry in the vertex shader and falloff in the fragment shader, so adding kinds adds no draw calls. Nothing in ADR-0037 is superseded.

**New public surface:**

- `SpotLight2d` — `{ color: Vec3; intensity: number; range: number; radius: number; direction: Vec2; innerAngle: number; outerAngle: number }`. A point light's radial falloff masked by an angular cone: `smoothstep(cos(outerAngle), cos(innerAngle), dot(direction, toFragment))`. `innerAngle`/`outerAngle` are half-angles in radians.
- `DirectionalLight2d` — `{ color: Vec3; intensity: number; direction: Vec2 }`. A positionless, full-screen flat add modelling a far-away source. Its `direction` has no visible effect until normal-map-aware lighting (§9.5) lands — until then it reads as a uniform directional ambient wash.
- `AmbientLight2d` — `{ color: Vec3; intensity: number; halfExtents?: Vec2 }`. A flat regional ambient zone: a world-space rectangle centred on the entity's `GlobalTransform` when `halfExtents` is set, summed additively over the global `Light2dSettings.ambient` floor. Without `halfExtents` it is global and equivalent to raising `Light2dSettings.ambient` (prefer the setting for a single floor).
- `SpotLight2dOptions`, `DirectionalLight2dOptions`, `AmbientLight2dOptions` — constructor input shapes.
- `Light2dKind` — `{ Point, Spot, Directional, AmbientZone }` instance discriminator constants.
- `packSpotLightInstance`, `packDirectionalLightInstance`, `packAmbientLightInstance` — per-kind pack functions exposed for tests / benches / custom plugins.

All three light components auto-attach the canonical `Transform + GlobalTransform + Visibility + InheritedVisibility + ViewVisibility` chain, identical to `PointLight2d`.

**Composite modes:**

- `Light2dSettings.compositeMode` now honours all three values: `'multiply'` (`base * light`), `'add'` (`base + light`), `'screen'` (`1 - (1 - base)(1 - light)`). The composite pipeline is specialised per mode (one fragment entry point each) rather than branching per pixel; `Light2dCompositeKey` gains a `compositeMode` field.

**Behaviour changes (non-breaking):**

- `LIGHT2D_INSTANCE_BYTE_SIZE` is now `52` (was `32`) and `LIGHT2D_INSTANCE_FLOAT_COUNT` is now `13` (was `8`) — three `float32x4` slots plus a trailing `float32` kind. Code reading these constants is unaffected; code that hard-coded `32` / `8` for the 2D-light instance layout must use the constants.
- `light2d-queue` now extracts and packs `SpotLight2d` / `DirectionalLight2d` / `AmbientLight2d` alongside `PointLight2d`. The batching shape (one batch per Core2d camera) is unchanged.
