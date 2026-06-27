# RetroHuman — parametric humanoid character system

- **Created:** 2026-06-27
- **Status:** In progress — Phase 1
- **Decisions:** ADR-0129 (morph-target GPU delivery — storage buffer, gated on `storageBuffers`,
  resolves the delta-delivery open question)

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
- **1.4 skinned + morphed variant** — `@group(3)` carries palette + deltas + weights; morph-then-skin
  (needed for RetroHuman facial expressions, Phase 5).

### Phase 2 — MakeHuman `.target` ingestion

What unlocks nose/ear/body sliders (the customization the GLB path can't carry).

- A `.target` parser (sparse `index x y z`, gunzip) → an engine "morph library" asset keyed to the
  base mesh's vertex order.
- An asset type / `.meta` sidecar via the `add-asset-type` skill path (ADR-0111) so target sets are
  discovered and identified by GUID.
- Validate vertex-count/index alignment against `base.obj` (targets are topology-locked).

### Phase 3 — Character creator panel + bake (edit-time)

The MetaHuman-feel authoring surface. Zero runtime cost, WebGL2-safe.

- Studio panel: curated macro + detail sliders driving target weights on the live base mesh
  (CPU-composed via the morph library).
- "Bake" → final mesh + skeleton + GLB asset that flows through the existing GLB/animation stack.
- Curate the slider set (start with face: nose/ears/cheek/chin/eyes/mouth/forehead; then macros).

### Phase 4 — Proxy fitting (clothes / hair)

The one genuinely new system. MakeHuman fits garments by pinning each proxy vertex relative to the
body surface so clothes deform with body *shape*, not just pose.

- Port MakeHuman's proxy-fitting (algorithm is CC0/open-source — reimplement, don't copy GPL code).
- Attach garments as sub-meshes skinned to the shared skeleton (pose-follow is "free" via existing
  skinning, ADR-0114); shape-follow needs the fitting data.

### Phase 5 — RetroHuman preset

The milestone that ties it together: curated base mesh + skeleton + a default rig + the
character-creator UX as a cohesive "spawn a humanoid" experience. Expressions arrive via the
Phase 1 path (GLB shape keys). Existing retargeting (ADR-0122–0127) lets foreign clips drive it.

**Future (not in initial scope):** full *runtime* in-game customization (live sliders moving the
mesh while the game runs) — requires resident deltas in a storage buffer, WebGPU-only, behind the
Phase 1 capability flag. Defer for cost/sequencing, not genre (CLAUDE.md §12).

## Open questions

- **Morph delta delivery threshold** — at what target count does the vertex-attribute path hand off
  to a storage buffer (and a capability gate)? Decided in Phase 1. ADR, mirrors ADR-0115.
- **Edit-time bake vs runtime-live** — initial scope is edit-time bake. Runtime-live is Phase 5
  future. Confirm before Phase 3.
- **Vendor vs fetch-on-demand** for the 37.7 MB target set — do we commit the CC0 assets to git, or
  keep the pinned fetch script and a small committed fixture? Likely an ADR.
- **Skeleton source** — reuse a MakeHuman/MPFB2 rig (`rigs/`) vs the engine's own; how it maps onto
  the existing retargeting reference pose (ADR-0125).
- **Proxy-fitting fidelity** — full barycentric body-surface fitting vs a cheaper approximation.

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
