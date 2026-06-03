# ADR-0064: Engine component registration coverage

- **Status:** Accepted
- **Date:** 2026-06-03

## Context

ADR-0061 codified CLAUDE.md §13 — every component defined in a shipped package either has a registered reflection schema or is a deliberately-classified non-serialized type — and registered the core graph plus one renderable family (`Transform`, `Name`, `Parent`, `Visibility`, `Mesh3d`, `MeshMaterial3d<M>`). Everything else was left as a tracked gap (`docs/backlog/engine-component-registration-coverage.md`): a scene with a camera, lights, or sprites could not round-trip.

This ADR closes the whole **component** gap. It registers every authored component across the camera, 3D-light, 2D-light, sprite, 2D-mesh/material, and post-process families in its owning plugin, and classifies every derived/transient one as a named not-serialized category. It does not touch ADR-0061, which stays sealed. It depends on ADR-0063 for the discriminated-union fields several of these components carry.

**Resources remain out of scope.** There is no resource-reflection mechanism yet (deferred by ADR-0060), so resource-shaped state is noted as blocked, not registered.

## Decision

**Authored components — registered, each in its owning plugin's `build()`:**

- **CameraPlugin** — `Camera` (scalars; `viewport` struct; `clearColor`/`target`/`depthTarget` as `t.variant`; `subGraph` as a branded-string `t.string`; `computed` `.skip()`), `PerspectiveProjection` (`aspectRatio` `.skip()`), `OrthographicProjection` (`scalingMode` as `t.variant`; `area` `.skip()`), `RenderLayers`.
- **VisibilityPlugin** — `NoFrustumCulling` (empty-schema marker).
- **Light3dPlugin** — `DirectionalLight3d`, `PointLight3d`, `SpotLight3d`, `CascadeShadowConfig`, `NotShadowCaster` (marker).
- **Light2dPlugin** — `PointLight2d`, `SpotLight2d`, `DirectionalLight2d`, `AmbientLight2d`, `LightOccluder2d`.
- **SpritePlugin** — `Sprite` (texture handles; `anchor` as a string-or-struct `t.variant`; `imageMode` as a `t.variant` embedding the nested value types), `TextureAtlas`, `AtlasAnimation` (`elapsedSec` `.skip()`); plus `TextureSlicer` and `BorderRect` as nested `registerType` value types.
- **MeshPlugin** — `Mesh2d` (shares the `Meshes` store and `'Mesh'` key with `Mesh3d`).
- **Material2dPlugin\<M>** — `MeshMaterial2d<M>`, the synthesized per-type subclass, under the generic-qualified name `MeshMaterial2d<MaterialName>`.
- **AoPlugin / TonemappingPlugin / MotionBlurPlugin / TaaPlugin** — `ScreenSpaceAo`, `Tonemapping`, `MotionBlur`, `Taa`.
- **PrepassPlugin** — `DepthPrepass`, `NormalPrepass`, `MotionVectorPrepass` (empty-schema markers).

**Derived / reciprocal / transient — deliberately not registered:**

- Computed each frame: `Frustum`, `ComputedCamera` (a `Camera` field, `.skip()`), `PreviousGlobalTransform`; and the transient *fields* `PerspectiveProjection.aspectRatio`, `OrthographicProjection.area`, `AtlasAnimation.elapsedSec` (all `.skip()`).
- Render-world / per-frame: `ExtractedCamera` and the `View*` caches (cleared every frame).
- Assets referenced by handle, never inlined: `TextureAtlasLayout`, `ColorMaterial2d`, and any other `Material2d`.

**Resources — deferred (blocked on resource reflection, ADR-0060):** `AmbientLight` (3D), `Shadow3dSettings`, `ClearColor`, `Light2dSettings`, `Light2dShadowState`, `Light2dNormalState`, `SortedCameras`, `TextureAtlasLayouts`, and the `Materials*` / `RenderMaterials*` registries.

**Non-obvious calls, with rationale:**

- **Camera render targets register only their data arms.** `target` registers `{ primary }`, `depthTarget` registers `{ auto } | { none }`. The `surface` / `texture` / `view` / `manual` arms carry live GPU references with no persistent identity (ADR-0063), so a camera holding one restores to its default arm. The `auto` arm's optional depth *format* is likewise not persisted — a minor, deliberate omission, not authored geometry.
- **`Camera.subGraph` is authored, not derived.** It is a branded string (`Core2dLabel` vs `Core3dLabel`) that distinguishes a 2D from a 3D camera and cannot be reconstructed from context, so it persists as a `t.string` (the brand is phantom).
- **Markers are authored opt-ins, registered with an empty schema.** `NoFrustumCulling`, `NotShadowCaster`, and the three prepass markers carry no fields, but a saved scene must preserve the per-entity decision (opt out of culling / shadow casting, opt into a prepass), so they register as `{}` and round-trip as presence.
- **Per-type 2D materials mirror 3D.** `Material2dPlugin<M>` synthesizes a `MeshMaterial2d<M>` subclass and registers it under a generic-qualified stable name, exactly as `MaterialPlugin<M>` does for 3D — the class-keyed ECS and the render queue match the exact subclass, so a base-only registration would be invisible.
- **`AmbientLight2d` is a component; 3D `AmbientLight` is a resource.** The 2D ambient is a per-entity regional (or global) pool, so it registers; the 3D ambient is a single scene-wide resource and waits on resource reflection.
- **Handle resolution stays consumer-supplied.** Each handle field names its asset store by key (`'Image'`, `'Mesh'`, `'TextureAtlasLayout'`, `'Materials2d'`) for the injected `resolveHandle`; no central engine resolver is added — the consumer wires it at spawn time, exactly as for `Mesh3d` (ADR-0061).

## Consequences

- Every component under `packages/*/src/**` is now classified — registered, or a named not-serialized category. The §13 component gap is closed; a scene with a camera, lights, sprites, and 2D meshes round-trips `serialize → JSON → spawnScene` with field values, hierarchy, recomputed `GlobalTransform`, and GUID-resolved handles intact.
- The only remaining §13 work is **resources**, which is a separate concern blocked on a resource-reflection mechanism; the backlog item is rescoped to that.
- Depends on ADR-0063: the camera, projection, and sprite schemas use the `t.variant` kind. Without it, their union fields could not round-trip.
- Accepted costs: a camera rendering to an offscreen GPU target (or a manual depth view, or a custom depth format) does not round-trip that field — it restores to the default arm; the consumer still supplies `resolveHandle` for the new asset stores.
- No benchmark: registration is one-shot load-time, and the variant codec it leans on runs at save/load, not per-frame (CLAUDE.md §11).

## Implementation

- `packages/engine/src/camera/camera-plugin.ts` — `Camera`, `PerspectiveProjection`, `OrthographicProjection`, `RenderLayers`
- `packages/engine/src/visibility/visibility-plugin.ts` — `NoFrustumCulling`
- `packages/engine/src/light3d/light-3d-plugin.ts` — `DirectionalLight3d`, `PointLight3d`, `SpotLight3d`, `CascadeShadowConfig`, `NotShadowCaster`
- `packages/engine/src/light2d/light-2d-plugin.ts` — `PointLight2d`, `SpotLight2d`, `DirectionalLight2d`, `AmbientLight2d`, `LightOccluder2d`
- `packages/engine/src/sprite/sprite-plugin.ts` — `Sprite`, `TextureAtlas`, `AtlasAnimation`, and the `TextureSlicer` / `BorderRect` value types
- `packages/engine/src/mesh/mesh-plugin.ts` — `Mesh2d` (alongside `Mesh3d`)
- `packages/engine/src/material2d/material-2d-plugin.ts` — the per-type `MeshMaterial2d<M>` subclass
- `packages/engine/src/ao/ao-plugin.ts` — `ScreenSpaceAo`
- `packages/engine/src/tonemapping/tonemapping-plugin.ts` — `Tonemapping`
- `packages/engine/src/motion-blur/motion-blur-plugin.ts` — `MotionBlur`
- `packages/engine/src/taa/taa-plugin.ts` — `Taa`
- `packages/engine/src/prepass/prepass-plugin.ts` — `DepthPrepass`, `NormalPrepass`, `MotionVectorPrepass`
- `packages/engine/src/scene/scene-roundtrip-3d.test.ts`, `packages/engine/src/scene/scene-roundtrip-2d.test.ts` — full-family round-trip coverage
- Deliberately not registered (derived/reciprocal/transient): `Frustum`, `ComputedCamera`, `ExtractedCamera`, `PreviousGlobalTransform`, the `View*` caches
