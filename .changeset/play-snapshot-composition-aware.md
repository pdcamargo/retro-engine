---
'@retro-engine/engine': minor
'@retro-engine/editor-sdk': patch
---

fix(editor-sdk): composition-aware play-mode snapshot (no duplicated glTF subtrees)

The play-mode snapshot captured a scene's glTF-instantiated (and nested-scene)
subtrees verbatim, then restore's `spawnScene` re-instantiated them — so every
Play→Stop cycle duplicated a model's node tree.

- `@retro-engine/engine`: `SerializeOptions` gains an optional `composition`
  (a `CompositionRegistry`); `serializeWorld` passes it to `collectComposition`
  so a bare-world caller can summarize derived subtrees to their authored root,
  the way `serializeScene` already does. Additive — existing callers are
  unchanged.
- `@retro-engine/editor-sdk`: `capturePlaySnapshot` now supplies the App's
  `CompositionRegistry`, so the snapshot stays entities-only but excludes
  generated children. Restore respawns the authored roots, which re-instantiate
  their subtrees exactly once.

Verified end-to-end in the studio via MCP: with the snapshot wiring installed, a
Play→edit→Stop cycle reverts an authored entity (Health 150→110) and leaves the
entity count unchanged (77 → 77) — the glTF character rig is no longer duplicated.
