---
'@retro-engine/runtime-web': minor
'@retro-engine/build': minor
'@retro-engine/engine': minor
---

feat(runtime-web): load the project's startup scene in the web export (ADR-0173)

A scene-driven project (entities authored in a `.rescene`) now boots with its
world in the web export, not an empty one. `bootWebGame` gains a `startupScene`
option; when set it installs a game-runtime baseline via the new
`installGameRuntime` (render stack — prepass / StandardMaterial / lights /
skybox — plus the scene + asset runtime with mesh/image/material/glTF loaders,
every add guarded so a project can override) and loads + spawns the scene via
`loadAndSpawnScene` before the run loop. The web export threads
`descriptor.startupScene` from `runWebExport` → `WebExportTarget` → `emitWebBoot`.
`App.hasPlugin(name)` is added to let a host install a baseline plugin only when
the project has not supplied its own.

Also fixes engine frustum culling of **skinned meshes**: they were culled by
their mesh bind-pose AABB, which a posed/animated skeleton deforms beyond — so a
character could wrongly vanish (it only showed in a multi-camera editor where
another camera framed the bind box). Entities with a `Skeleton` now skip the
bind-pose frustum test (like `NoFrustumCulling`), so posed characters render
correctly under a single game camera. (Joint-derived skinned bounds are a
tracked follow-up.)
