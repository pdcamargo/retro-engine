# Asset retrofit — absorb Image/Mesh/Material/atlas into `Assets<T>` (big-bang)

- **Created:** 2026-05-31

## Context

Phase 3 of the asset system (ADR-0055), and the load-bearing one: fold the four existing asset-shaped
types into the unified store in a **single** change (the chosen retrofit style), deleting the bespoke
branded-handle types rather than aliasing them.

Convert, keying everything on `handle.index` (ADR-0055 §1 — the draw-time key stays a `number`):

- `Image` → `Assets<Image>`; `ImageHandle` → `Handle<Image>`. The `WHITE`/`BLACK`/`NORMAL_FLAT`
  defaults become well-known seeded handles. `RenderImages` stays `Map<AssetIndex, RenderImage>`; the
  bind-group fallback resolution is unchanged.
- `Mesh` → `Assets<Mesh>`; `MeshHandle` → `Handle<Mesh>`. `RenderMeshes` stays keyed by index.
  `MeshAllocator` free/slice paths are **unchanged** — they already key on the numeric index
  (`vertexSlice(handle.index)`), the single most important invariant to preserve.
- `Material` → `Assets<M>` **one store per material type** (ADR-0055 §6); `MaterialHandle<M>` →
  `Handle<M>`. `RenderMaterials<M>` stays keyed by index. Same for `material2d`.
- `TextureAtlasLayout` → `Assets<TextureAtlasLayout>`; `TextureAtlasLayoutHandle` →
  `Handle<TextureAtlasLayout>` (lives under `packages/engine/src/sprite/`).
- The per-type `{ kind: 'added'|'modified'|'removed', handle }` unions generalize to `AssetEvent<T>`;
  extract systems drain the store's event queue exactly as they drain `drainPendingChanges()` today.
- Update handle-bearing components (`Mesh3d`, `MeshMaterial3d`, `Mesh2d`, `MeshMaterial2d`, sprite /
  atlas references) and the `packages/engine/src/index.ts` re-exports. Register stores via
  `core-plugin.ts`.

Files: `packages/engine/src/image/*`, `mesh/*`, `material/*`, `material2d/*`, `sprite/*` (atlas),
`core-plugin.ts`. Read the real source, not just the prior ADRs.

## Why deferred

Depends on both earlier phases. It is one large diff across the render pipeline, so it is its own
gated change rather than smeared across the foundation PRs — the index-primary keying is what keeps
the blast radius to type renames + the handle wrapper instead of a draw-path rewrite.

## Acceptance

- Full engine test suite green after the conversion; the old branded-handle types
  (`ImageHandle`/`MeshHandle`/`MaterialHandle`/`TextureAtlasLayoutHandle`) and bespoke registries are
  deleted, not aliased.
- `bench:check` (after `bench:update`) shows **no draw-time regression** beyond the ADR-0017 1.5×
  threshold; the baseline diff is committed with the change.
- The playground renders meshes, sprites, and materials **identically** to pre-retrofit.
- `assets.add()` (runtime asset) and `assets.getMut()` (hot-mutate → re-prepare) drive a visible
  update in the playground.
- `lint` / `test` / `build` / `bench` green; **breaking** changeset present (public handle/registry
  types changed across `packages/engine` and `packages/assets`).
