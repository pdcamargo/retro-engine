# Studio asset indexer must ignore `node_modules`

- **Created:** 2026-07-08

## Context

Opening a project in the studio, its asset indexer walks the project tree and
mints `.meta` sidecars for discovered assets. It does **not** exclude
`node_modules`, so it descends into linked workspace packages and mints stray
sidecars inside them.

Observed after `@retro-engine/runtime-web` gained a `@retro-engine/gltf` dependency
(ADR-0173): the studio project `retro-game-sample` symlinks `runtime-web` (which
symlinks `gltf`) into its `node_modules`, and the indexer followed the symlink into
the engine repo's `packages/gltf/src/__fixtures__/` and wrote `Clover_1.gltf.meta`
there — a spurious file in a package's source, and load errors in the studio console
for `node_modules/.../__fixtures__/Clover_1.gltf` (403).

## Wanted

The asset indexer (and the project file watcher / manifest scan) skips
`node_modules` (and `dist`, `.re`, etc.) so it only indexes authored project assets.
Do not mint `.meta` for anything under `node_modules`.

_Links:_ studio project indexing (`apps/studio/src/project/`), `scanProjectManifest` / `scanMetaManifest`.
