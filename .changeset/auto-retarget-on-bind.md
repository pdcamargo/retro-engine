---
'@retro-engine/engine': minor
'@retro-engine/gltf': minor
---

feat(animation): auto-retarget foreign clips on bind

Assigning an animation clip authored for one model to a rig instantiated from a different model now Just Works — no retarget UI, no authoring step. When a clip-bearing component (`AnimationPlayer`, `AnimationControllerPlayer` motions, `AnimationLayers` clip sources) resolves a clip whose skeleton differs from the entity's rig, the engine retargets it to that rig by bone name, at assign time and again on scene load. A clip native to the rig's model is untouched.

The scene stores only the original clip reference (`"<modelGuid>#AnimationN"`); the retargeted clip is derived, cached, and never persisted, so reload re-derives it.

**New public surface:**

- `@retro-engine/engine`: `EffectiveClips` (+ `EffectiveClipsView`, `effectiveClip`) — a transient resource the sampler resolves every clip through, so a foreign clip plays its retargeted form without rewriting the authored handle. Inserted by `AnimationPlugin`; empty (a no-op) unless a retarget path populates it.
- `@retro-engine/gltf`: `buildHumanoidRetargetRigFromGltf(gltf, name?, opts?)` — builds a source `RetargetRig` straight from a loaded glTF document; `addGltfAutoRetarget(app)` — the bind-time reactor that detects foreign clips, retargets, caches by `(sourceClipGuid, targetRigSignature)`, and feeds `EffectiveClips`. Registered by `GltfPlugin`.

Foreign detection compares the clip's origin model GUID against the rig's `GltfSceneRoot` model (falling back to track-id intersection for non-glTF rigs); a source model still loading suppresses the clip rather than playing it mis-targeted, so an in-flight load never flickers a wrong pose.

Also fixes scene loading of a persisted model-clip reference: `GltfPlugin` now registers the `Animation` sub-asset store (so `"<modelGuid>#AnimationN"` resolves at scene-load time in hosts that add the `AssetServer` after the core plugins), and the auto-retarget system captures the target rig after composition overrides are applied.
