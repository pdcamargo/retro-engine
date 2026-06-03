# Engine component registration coverage

- **Created:** 2026-06-03

## Context

CLAUDE.md §13 requires every component defined in `packages/*/src/**` to declare its serialization — a registered schema, or a deliberate non-serialized classification. ADR-0061 registered the core graph + one renderable family: `Transform`, `Name`, `Parent`, `Visibility`, `Mesh3d`, `MeshMaterial3d<M>`, with `GlobalTransform` / the inherited+view visibility booleans / `Children` deliberately omitted as derived/reciprocal.

Everything else is still unregistered: cameras (`Camera`, the projection components, the `Camera3d` / `Camera2d` bundle parts), 3D lights (`DirectionalLight3d`, `PointLight3d`, `SpotLight3d`, `AmbientLight`, shadow settings), the 2D stack (`Sprite`, `Mesh2d`, `Material2d`, atlas / animation), prepass markers (`DepthPrepass`, `NormalPrepass`, `MotionVectorPrepass`), `NoFrustumCulling`, render-layers, and more. A scene that round-trips a real playable view needs at least the camera + lights registered.

## Why deferred

ADR-0061 scoped to the core graph + one renderable family to keep that slice bounded. The rest is fill-in, best done per §13 as each owning system is touched, or as a focused sweep once a consumer (full-scene save/load) needs a given family. No new mechanism is required — each is an `app.registerComponent(...)` in the owning plugin or a documented non-serialized classification.

## Acceptance

- Every component class under `packages/*/src/**` is either registered (schema in its owning plugin) or explicitly classified non-serialized (derived / reciprocal / transient), tracked in a deliberately-omitted list.
- A scene containing a camera, one or more lights, and a sprite round-trips `serialize → JSON → spawnScene` with those components restored.
