---
'@retro-engine/engine': minor
---

feat(engine): reflection schemas for every authored component — ADR-0064

ADR-0061 registered the core graph plus one renderable family; every other component was an unregistered, tracked gap (CLAUDE.md §13). This closes the whole component gap — each authored component now declares its serialization in its owning plugin, and each derived/transient one is a named not-serialized category.

Newly registered: cameras (`Camera`, `PerspectiveProjection`, `OrthographicProjection`, `RenderLayers`), 3D lights (`DirectionalLight3d`, `PointLight3d`, `SpotLight3d`, `CascadeShadowConfig`, `NotShadowCaster`), 2D lights (`PointLight2d`, `SpotLight2d`, `DirectionalLight2d`, `AmbientLight2d`, `LightOccluder2d`), the 2D stack (`Sprite` with its 9-slice + atlas config, `TextureAtlas`, `AtlasAnimation`, `Mesh2d`, per-type `MeshMaterial2d<M>`), and per-camera post-process config (`ScreenSpaceAo`, `Tonemapping`, `MotionBlur`, `Taa`, the prepass markers).

A scene with a camera, lights, sprites, and 2D meshes now round-trips `serialize → JSON → spawnScene` with field values, hierarchy, recomputed `GlobalTransform`, and GUID-resolved handles intact. Union-typed fields (clear color, ortho scaling mode, sprite anchor / 9-slice) ride on the new reflect `t.variant` kind. Resources (e.g. `AmbientLight`, `ClearColor`, `Light2dSettings`) stay deferred — they await a resource-reflection mechanism.
