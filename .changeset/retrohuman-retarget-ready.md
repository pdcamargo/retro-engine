---
'@retro-engine/engine': minor
---

feat(engine): name rig joints + Unreal-mannequin humanoid aliases

Makes a spawned rig retarget-ready (RetroHuman Phase 5).

- `spawnRig` accepts `{ names }` (parallel to joint order) and attaches a `Name`
  to each joint entity, so name-based humanoid retargeting can map the skeleton.
- The humanoid auto-map (`slotForBoneName`) recognizes Unreal-mannequin /
  MakeHuman `game_engine` bone names (`pelvis`, `neck_01`, `upperarm_*`,
  `lowerarm_*`, `thigh_*`, `calf_*`, `foot_*`, `ball_*`) in addition to the
  existing Synty + Mixamo sets — so the RetroHuman skeleton (and any UE-named
  rig) maps onto the humanoid retarget rig without hand-editing.

Verified through a full App: a spawned `game_engine`-named skeleton auto-maps all
22 humanoid slots via `buildHumanoidRetargetRig`.
