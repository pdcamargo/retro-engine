# Auto-retarget foreign clips on bind

- **Created:** 2026-06-26
- **Status:** Planning

## Goal

Assigning an animation clip that came from a *different* model than the rig it's
played on Just Works, with no retargeting UI and no authoring step. When a
clip-bearing component (`AnimationPlayer.clip`, an `AnimationController` motion,
an `AnimationLayers` clip source) resolves a clip whose skeleton differs from the
entity's rig, the engine retargets it to that rig automatically — at assign time
and again on scene load — by bone name. The scene stores only the original clip
reference (`sourceModel#AnimationN`, per [ADR-0126](../adr/ADR-0126-sub-asset-references-via-composite-guid-uris.md));
the retargeted clip is derived, cached, and never persisted, so it re-derives
cleanly on reload. Success = drop any `A_*.glb` clip onto the `Character.glb` rig
through the inspector and see it animate correctly, with no extra clicks.

This builds on the retargeting engine, which already exists and is tested
([ADR-0122](../adr/ADR-0122-animation-retargeting-rig-mapping-and-contact-pinning.md));
the missing piece is the *automatic bind-time wiring*, not the retarget math.

## Phases

1. **Foreign-clip detection** — a runtime check: a clip is "foreign" to an entity
   when its track target-ids don't intersect the `AnimationTarget` ids under that
   player. Native clips skip retargeting entirely (no-op). Promote to backlog first.
2. **Source-rig extraction from a clip's origin** — given a sub-asset clip GUID
   (`sourceModel#AnimationN`), load the source model and build its `RetargetRig`
   (bone names + rest pose) from its skin/nodes. Target rig comes from the player's
   named bone subtree.
3. **Retarget-on-bind system + cache** — a system that, for each clip-bearing
   component, retargets a foreign clip via `retargetClip`, caches the result keyed
   by `(sourceClipGuid, targetRigId)`, and swaps the component onto the derived
   clip. Runs on assignment and on spawn/load (same path), so reload re-derives.
4. **Coverage across clip slots** — extend beyond `AnimationPlayer.clip` to the
   `AnimationController` motions and `AnimationLayers` clip sources (the blend-tree
   path), so every place a clip binds gets the same treatment.

## Open questions

Each likely becomes an ADR before code.

- **Reference-pose source (the hard one).** Retargeting now goes through a *shared
  reference pose* rather than each rig's bind (commit `6c2d3d5`). Auto mode has to
  pick that reference pose with no human in the loop; the wrong choice reads as
  pose drift/offset, not an error. Candidate default: the target rig's bind as the
  reference, with hip-height proportion scaling for root translation. Needs an ADR.
- **Cache identity & invalidation.** What exactly keys a cached retargeted clip,
  and when is it dropped (source clip reload, target rig change, hot reload)?
- **Bone-name mapping failures.** When source/target bone names don't line up
  (non-standard rigs), what's the fallback — partial map, identity passthrough, or
  a surfaced warning? Must not silently produce a broken pose.
- **Where the derived clip lives.** A runtime-only `Assets<AnimationClip>` entry
  with no persistent GUID (re-created each load), vs. a deterministic derived GUID
  so multiple players can share one retargeted clip. Affects the cache and memory.
- **Timing vs. async loads.** The source model may still be loading when the player
  binds; the system must wait a frame and retarget once available, without flicker.

## Links

- Related ADRs: [ADR-0122](../adr/ADR-0122-animation-retargeting-rig-mapping-and-contact-pinning.md)
  (retargeting math), [ADR-0126](../adr/ADR-0126-sub-asset-references-via-composite-guid-uris.md)
  (the `sourceModel#AnimationN` references this consumes), [ADR-0116](../adr/ADR-0116-animation-clip-data-model-and-property-path-addressing.md)
  (clip/track target-id model).
- Related backlog: [sub-asset-enumeration-and-assignment-followups](../backlog/sub-asset-enumeration-and-assignment-followups.md).
- Engine: `packages/engine/src/animation/retarget/*` (`retargetClip`, `RetargetRig`),
  `animation-plugin.ts` (where the new system registers), `animation-player.ts` /
  `animation-system.ts` (bind path).
