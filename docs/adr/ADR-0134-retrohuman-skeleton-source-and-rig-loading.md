# ADR-0134: RetroHuman skeleton source and rig/weights loading

- **Status:** Accepted
- **Date:** 2026-06-27

## Context

The RetroHuman preset (roadmap Phase 5) needs a skeleton: a joint hierarchy plus
per-vertex skin weights so the CC0 `base.obj` deforms and can be animated. Two
questions had to be resolved:

1. **Whose skeleton?** The engine already has a GPU skinning path (ADR-0114) and
   a retargeting stack (ADR-0122–0127) but no canonical humanoid rig. We could
   author our own, or adopt one of MakeHuman's CC0 rigs under `vendor/makehuman/rigs/`.
2. **How is rig/weights data loaded into a project?** The vendored data is
   `rig.<name>.json` (bone hierarchy) + `weights.<name>.json` (bone → `[vertex, weight]`).
   These are plain JSON. The asset system (ADR-0111/0055/0089) discovers loose
   files by extension and mints `.meta` sidecars, but a discoverable extension is
   claimed globally — and the weights parser additionally needs the rig **and**
   the base mesh's vertex count, context an isolated byte-importer cannot see.

The rig data is authored against the exact `base.obj` vertex order: a bone's
weight list indexes base vertices directly. Any skeleton we ship must align with
that vertex order or the weights are meaningless.

## Decision

**Skeleton source: reuse MakeHuman's CC0 `game_engine` rig (53 bones).** It is
authored against the base mesh's vertex order, is CC0 (unencumbered output), and
is a clean game-oriented humanoid hierarchy. The engine does not impose its own
canonical skeleton; the RetroHuman preset *adopts* MakeHuman's. Foreign clips
(e.g. a Mixamo download) reach it through the existing retargeting path, not
through a shared fixed skeleton.

**Rest pose:** each joint's rest global is a pure translation to its `head`
(identity rest rotation); local translation is the head offset from the parent's
head. This is what `buildRigPose` produces and is the convention the `.target`-driven
base mesh assumes. The retargeting reference pose (ADR-0125) is computed from this
bind pose at bind time, so no separate mapping table is needed — `bindRetargetRig`
runs against the spawned skeleton like any other character.

**Rig/weights loading: by convention path, not a discoverable asset kind.** The
RetroHuman preset reads `rig.<name>.json` and `weights.<name>.json` from a known
project location (`assets/human/`) as raw bytes through the project `AssetSource`,
then parses them with `parseMakeHumanRig` / `parseMakeHumanWeights` at the use
site, where the rig and the base mesh's vertex count are both available. No new
asset kind is registered, because:

- `.json` is too generic to claim as a discoverable extension globally.
- The weights parser is not a self-contained importer — it needs the rig + base
  vertex count, so a per-file `AssetImporter` cannot produce a finished value.
- Rig/weights are studio-preset *inputs*, not user-authored scene assets.

A dedicated rig/skeleton asset kind (its own extension, a richer skeleton-asset
design that bundles rig + weights + bind metadata) is deferred to a future slice.

## Consequences

- The RetroHuman output is fully CC0 — shippable in a closed-source game with no
  attribution, the whole point of building on MakeHuman assets.
- Skinning and retargeting reuse the existing palette + reference-pose machinery
  unchanged; the preset only supplies joint entities + inverse binds + weights.
- The rest-pose-as-pure-translation choice means the bind pose carries no rest
  rotations; clips authored against a rest-rotated rig still work because
  retargeting transfers rotations as deviations from each side's reference pose.
- Loading by convention path keeps the asset registry uncluttered, at the cost of
  the rig/weights not appearing in the asset browser as first-class assets and not
  being GUID-referenced from a scene. The deferred skeleton-asset kind closes that
  gap when a non-preset consumer needs it.
- A project must stage `base.obj` + `rig.<name>.json` + `weights.<name>.json` under
  `assets/human/` for the preset to spawn; absence is handled by the panel
  reporting the preset unavailable rather than failing.

## Implementation

- `packages/engine/src/rig/rig-pose.ts` — `buildRigPose`, `RigPose`
- `packages/engine/src/rig/spawn-rig.ts` — `spawnRig`, `SpawnedRig`
- `packages/engine/src/rig/skin-weights-mesh.ts` — `applySkinWeights`
- `packages/engine/src/rig/makehuman-rig.ts` — `parseMakeHumanRig`, `MakeHumanRig`, `RigBone`
- `packages/engine/src/rig/makehuman-weights.ts` — `parseMakeHumanWeights`, `SkinWeights`
- `packages/engine/src/skinning/skeleton.ts` — `Skeleton` (consumed by `spawnRig`)
- `apps/studio/src/panels-character-creator.ts` — "Spawn RetroHuman" preset (rig/weights
  read via the project `AssetSource`, mesh skinned via `applySkinWeights`)
