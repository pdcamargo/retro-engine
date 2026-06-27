---
'@retro-engine/engine': minor
---

feat(engine): rig pose + skinned-character spawn for RetroHuman

Turns a parsed MakeHuman rig into a posable, skinned character (Phase 5).

- `buildRigPose(rig)` → `RigPose`: per-joint parent index, rest-pose local
  translation (`head - parentHead`), and inverse bind matrix (`inverse(translate(head))`),
  all in joint order so a vertex's `JOINTS_0` index addresses them directly.
- `spawnRig(world, pose, root?)` → `SpawnedRig`: spawns a joint-entity hierarchy
  (with `Parent`/`Children` edges so transform propagation follows a posed joint
  down its subtree) and returns a `Skeleton` bound to it, ready to attach to the
  mesh entity.
- `applySkinWeights(mesh, weights)`: attaches `JOINTS_0` / `WEIGHTS_0` vertex
  attributes from parsed `SkinWeights` so the mesh skins through the existing GPU
  skinning path.

Verified through a full App: posing an ancestor joint deforms a descendant via
the recomputed skinning palette.
