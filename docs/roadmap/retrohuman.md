# RetroHuman — parametric humanoid character system

- **Created:** 2026-06-27
- **Status:** In progress — Phases 1–3 complete, Phase 4 next
- **Decisions:** ADR-0129 (morph-target GPU delivery — storage buffer, gated on `storageBuffers`),
  ADR-0130 (MakeHuman `.target` ingestion — sparse morph-target assets; vendor data fetch-on-demand),
  ADR-0131 (vertex-order base mesh + CPU morph composition; edit-time-bake scope),
  ADR-0132 (character bake to a static mesh; disk/GLB persistence deferred)

## Goal

A "MetaHuman for Retro Engine": author and customize a humanoid in the studio — reshape the
face and body (nose size/shape, ears, jaw, cheeks, eyes, mouth, proportions), dress it with
clothes/hair that follow the body's shape, then rig, pose, and animate it — producing a baked,
shippable character asset. Built entirely on MakeHuman's **CC0** base mesh + targets, so the
output is unencumbered (usable in a closed-source game, no attribution). The runtime morph-target
primitive that powers this is a general engine feature, not RetroHuman-specific: it also drives
facial expressions/visemes for any glTF model.

Success = in the studio, spawn a RetroHuman, drag a slider to widen the nose / enlarge an ear /
fatten the body, put a shirt on it that stretches to fit, and bake it to a mesh + skeleton + GLB
that plays back through the existing animation/retargeting stack.

## What the research established (load-bearing facts)

- **MakeHuman targets and glTF morph targets are the same primitive** — a sparse list of moved
  vertices (`vertexIndex x y z`, relative to `base.obj`) on a fixed-topology mesh. "Nose size" and
  "a smile" differ only in *how many* you keep live and *when* you apply them, not in mechanism.
- **Two ingestion paths, not one:**
  1. **glTF/GLB → expressions.** Anything authored as a Blender shape key exports as a real glTF
     morph target through the existing `@retro-engine/gltf` pipeline. Good for a **curated small
     set** (expressions, visemes, correctives). The runtime ≤N-targets path handles this cheaply.
  2. **Raw `.target` files → full customization.** There are **1,258** targets (37.7 MB), far too
     many to ship through a GLB or hold as live vertex attributes. Full face/body customization
     requires ingesting MakeHuman's raw `.target` data directly onto the base mesh. CC0 explicitly
     permits this ("take the base mesh + targets and build a full character generator").
- **Asset provenance** — `makehumancommunity/mpfb2`, `src/mpfb/data/`: base mesh at
  `3dobjs/base.obj`; targets under `targets/<region>/*.target.gz` (gzipped ASCII); rigs under
  `rigs/`; expression shape keys under `expressions/`. Pinned ref + fetch script live in
  `vendor/makehuman/` (see `vendor/makehuman/README.md`). Code is GPL/AGPL (do **not** vendor MPFB2
  code); assets are CC0 (`LICENSE.ASSETS.md`).

## Phases

Each phase promotes to one or more `docs/backlog/*.md` when scheduled.

### Phase 1 — Runtime morph targets (engine primitive) — **build first**

Promotes the deferred "Morph targets" item in `docs/roadmap/gltf.md` (Phase B). General-purpose,
independent of MakeHuman.

Tracked in `docs/backlog/runtime-morph-targets.md` (slices 1.1–1.4). Delivery: **single storage-buffer
path at `@group(3)`, gated on `storageBuffers`** (ADR-0129, mirrors ADR-0115); research showed the
vertex-attribute path is unviable (WebGL2's 16-attribute budget is already saturated), so the
"≤N vertex-attribute vs storage threshold" open question is resolved as "no threshold". WebGL2
data-texture path declared + deferred.

- ✅ **1.1 data layer** — glTF parses `primitive.targets` (POSITION/NORMAL deltas) + `mesh.weights` +
  `mesh.extras.targetNames`; `Mesh.morphTargets` delta store; `MorphWeights` component (reflection
  schema per §13); instantiation attaches `MorphWeights`. Unit-tested, gate green.
- ✅ **1.2 GPU delivery + WGSL** — `MorphGpu` (per-mesh delta buffer + per-entity weights/params at
  `@group(3)`), `material-queue-morphed`, `#ifdef MORPHED` in `pbr.wgsl` (morph before skinning);
  `packMorphDeltas` bench. Verified in studio: a glTF morph weight driven 0→1 deforms the live mesh.
  Prepass participation deferred (backlog).
- ✅ **1.3 animation + inspector** — glTF `weights` channels drive `MorphWeights` (`applyTrack`
  array-leaf sampling, unit-tested through a full App); studio inspector renders one `[0,1]` slider
  per target name (verified live: an "inflate" slider replaces the raw arrays).
- ✅ **1.4 skinned + morphed variant** — combined `@group(3)` (palette binding 0 + morph 1/2/3),
  `SKINNED`+`MORPHED` vertex module (morph-then-skin), per-entity combined bind group + draw in the
  skinned queue. Verified live: a skinned cube with an "inflate" target both skins and inflates.

**Phase 1 complete.** Runtime morph targets ship end-to-end. Deferred refinements tracked in
`docs/backlog/morph-target-followups.md`.

### Phase 2 — MakeHuman `.target` ingestion

What unlocks nose/ear/body sliders (the customization the GLB path can't carry).
**Phase 2 complete** (ADR-0130). The "morph library" is realized as the collection of per-`.target`
assets the creator gathers (Phase 3), not a separate on-disk container.

- ✅ `.target` parser (`parseSparseMorphTarget`) → `SparseMorphTarget` (sparse `index dx dy dz`,
  `maxIndex`/`fitsBase`/`toDense`). Plain text, not gzipped. Unit-tested + verified on real vendored
  targets.
- ✅ Asset kind `'MorphTarget'` (ext `target`, discoverable, category `morph`) + `.meta` sidecar via
  the `add-asset-type` path (ADR-0111). Verified live: a vendored `.target` is discovered,
  sidecar'd, and loads through the AssetServer.
- ✅ Index/base alignment validated at composition (`fitsBase`/`toDense` reject out-of-range indices
  against the actual base vertex count) — a `.target` carries no base reference to check at import.

### Phase 3 — Character creator panel + bake (edit-time)

The MetaHuman-feel authoring surface. Zero runtime cost, WebGL2-safe. Foundations sealed in ADR-0131
(vertex-order base mesh + CPU composition; edit-time-bake scope confirmed).

- ✅ **3.1 base mesh loading** — `parseObjBaseMesh` (vertex-order-preserving OBJ→Mesh, quad-triangulated,
  smooth normals, per-vertex UV) so `.target` indices align. Verified on real `base.obj` (19,158 verts).
- ✅ **3.2 CPU morph composition** — `composeMorphedPositions` (sparse `base + Σ wᵢ·deltaᵢ`), unit-tested
  + benched (~36 µs @ 19,158 verts × 40 targets).
- **3.3 character creator panel** (apps/studio): curated macro + detail sliders driving target weights
  on the live base mesh; recompose + re-upload + recompute normals on edit.
  - ✅ **3.3a** `ObjMesh` asset kind (`.obj` → `Mesh` via `parseObjBaseMesh`, into the shared `Meshes`
    store). Verified live: `base.obj` loads (19,158 verts), renders, and `getMut` + sparse compose +
    `computeSmoothNormals` reshapes it (renderer stays healthy).
  - ✅ **3.3b** the `/character-creator` panel: detects the project's base `.obj` + `morph` targets,
    loads them, spawns a preview, and renders a `[0,1]` slider per target. Slider edits recompose the
    live mesh (`composeMorphedPositions` + `getMut` + `computeSmoothNormals`). Verified live: the
    "nose-base-down" slider reshaped the preview (vertex moved by the exact composed delta).
- ✅ **3.4 bake** — `bakeMorphedMesh` freezes current weights into a static `Mesh` (composed positions
  + copied UV/indices + recomputed normals); panel "Bake" button spawns it as a standalone character.
  Verified live: a baked 19,158-vertex mesh carries the composed shape and renders. Persist-to-`.rmesh`
  + GLB export deferred (ADR-0132, `docs/backlog/baked-character-persistence.md`).
- Curate the slider set (start with face: nose/ears/cheek/chin/eyes/mouth/forehead; then macros).

**Phase 3 complete.** The MetaHuman-feel authoring surface works end-to-end: load base → slider-reshape
→ bake. Slider-set curation per `target.json` regions and rig-on-bake arrive with Phase 5.

### Phase 4 — Proxy fitting (clothes / hair)

The one genuinely new system. MakeHuman fits garments by pinning each proxy vertex relative to the
body surface so clothes deform with body *shape*, not just pose. Full barycentric fitting (ADR-0133).

- ✅ **4.1 `.mhclo` parser + fitting model** — `parseMhclo` → `ProxyFitting` (per proxy vertex: base
  triangle + barycentric weights + offset; optional `x/y/z_scale`). Unit-tested.
- ✅ **4.2 fit solve** — `fitProxy(basePositions, fitting, out?)` = `Σ wᵢ·base[triᵢ] + scaled offset`.
  Unit-tested (a garment vertex follows its base triangle on morph + offset scales with proportions)
  and benched.
- **4.3 studio wiring** — load a garment (`.obj` proxy + `.mhclo`) as a sub-mesh; re-fit on body
  morph; skin to the shared skeleton for free pose-follow (ADR-0114). `.mhclo` proxies are
  fetch-on-demand / synthetic fixtures (not staged in `vendor/`).

### Phase 5 — RetroHuman preset

The milestone that ties it together: curated base mesh + skeleton + a default rig + the
character-creator UX as a cohesive "spawn a humanoid" experience. Expressions arrive via the
Phase 1 path (GLB shape keys). Existing retargeting (ADR-0122–0127) lets foreign clips drive it.

**Future (not in initial scope):** full *runtime* in-game customization (live sliders moving the
mesh while the game runs) — requires resident deltas in a storage buffer, WebGPU-only, behind the
Phase 1 capability flag. Defer for cost/sequencing, not genre (CLAUDE.md §12).

## Open questions

- ✅ **Morph delta delivery threshold** — resolved (ADR-0129): single storage-buffer path, no
  threshold; vertex-attribute path rejected (WebGL2 budget). WebGL2 data-texture path deferred.
- ✅ **Edit-time bake vs runtime-live** — resolved (ADR-0131): initial scope is edit-time CPU bake;
  runtime-live customization stays a Phase 5 future (resident deltas, WebGPU-only).
- ✅ **Vendor vs fetch-on-demand** — resolved (ADR-0130): fetch-on-demand. Asset *type* committed,
  asset *data* not; full 37.7 MB set via `fetch.sh --full`; tests use small inline fixtures.
- **Skeleton source** — reuse a MakeHuman/MPFB2 rig (`rigs/`) vs the engine's own; how it maps onto
  the existing retargeting reference pose (ADR-0125).
- ✅ **Proxy-fitting fidelity** — resolved (ADR-0133): full barycentric body-surface fitting (the
  correct primitive; a cheaper snap/rigid fit tears garments off a re-proportioned body).

## Links

- `docs/roadmap/gltf.md` — Phase B "Morph targets" (this roadmap promotes it)
- `docs/roadmap/skeletal-animation.md` — skinning + retargeting this consumes
- ADR-0114/0115 (GPU skinning + joint-palette delivery — delta-delivery parallel)
- ADR-0116/0117 (animation clip model + player — drives morph weights)
- ADR-0122–0127 (retargeting — lets foreign clips drive a RetroHuman)
- ADR-0111 (asset kind registry + sidecar — Phase 2 asset type)
- `vendor/makehuman/` — pinned CC0 assets + fetch script
- MakeHuman CC0 license: <http://www.makehumancommunity.org/content/license_explanation.html>
- Build-a-char-gen FAQ (CC0 permits it): <https://static.makehumancommunity.org/mpfb/faq/build_other_chargen.html>
- `.target` format (TargetsV2): <http://www.makehumancommunity.org/wiki/Documentation:TargetsV2>
- MPFB2 source (assets CC0, code GPL/AGPL): <https://github.com/makehumancommunity/mpfb2>
