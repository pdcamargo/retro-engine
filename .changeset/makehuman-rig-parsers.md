---
'@retro-engine/engine': minor
---

feat(engine): MakeHuman rig + skin-weights parsers

The skeleton foundation for the RetroHuman preset (Phase 5). Parses the CC0 MakeHuman rig data so the
base mesh can be skinned and animated.

- `parseMakeHumanRig` → `MakeHumanRig`: bones (`name`, `head`, `tail`, `parent`) from a
  `rig.<name>.json`, ordered topologically (every bone after its parent) with a name→index map, so a
  bone's index is a stable joint index.
- `parseMakeHumanWeights` → `SkinWeights`: inverts a `weights.<name>.json` (`bone → [vertex, weight]`)
  into per-vertex top-4 influences (`JOINTS_0` + normalized `WEIGHTS_0`, keyed by joint index),
  unweighted vertices pinned to the root.

Reimplemented from the open/CC0 format (MakeHuman code is GPL — not copied). Unit-tested and verified
on the real 53-bone `game_engine` rig: topological order holds, and all 19,158 base vertices' weights
normalize to 1.
