# Skeletal Animation

- **Created:** 2026-06-25
- **Status:** Phase 0 (GPU skinning) **shipped** — confirmed working 2026-06-25 (ADR-0114, ADR-0115).
  Phase 1 (clip playback) **shipped** — confirmed working 2026-06-25 (ADR-0116, ADR-0117).
  Phase 2 (pose pipeline) **shipped** — confirmed working in the editor 2026-06-25 (ADR-0118, ADR-0119).
  Phase 3 (layers + avatar masks) **shipped** — confirmed working in the editor 2026-06-25 (ADR-0120).
  Phase 4 (IK) **shipped** — confirmed working in the editor 2026-06-25 (ADR-0121) — core solvers in,
  broader IK/constraint space backlogged (`docs/backlog/ik-and-rig-constraints.md`).
  Phase 5 (retargeting) **shipped, pending editor confirmation** 2026-06-25 (ADR-0122) — `RetargetRig`
  rig-description asset + `retargetClip` clip-production transform; lint/typecheck/test/build/bench green.
  This is the **final** phase.
- **Decisions:** ADRs to be written per phase (see *Open questions*). Builds on ADR-0057 (glTF
  import — reserves skins/animations), ADR-0060/0061 (reflection — every authored component here needs
  a schema), ADR-0102 (hot reload — schemaless authored components are dropped on every code swap).

## Goal

Skinned characters that actually deform: move a bone and the mesh follows it; play animation clips;
blend them; scope animations to parts of the body with **avatar masks** layered Unity-style; solve
limbs with **IK**; and play one skeleton's animation on a differently-proportioned skeleton via
**retargeting**. WebGL2-reachable from day 1 — the joint-palette delivery path is capability-gated
(ADR-0057 §12 already reserved this), no WebGL2-incompatible feature sneaks in unflagged (CLAUDE.md
§5.4 / §10).

This promotes the deferred **Skins / GPU skinning** and **Animation clips** items from
`docs/roadmap/gltf.md` Phase B into their own initiative. Today the engine has the *skeleton
hierarchy* (glTF bone nodes become entities with `Transform`/`Parent`/`Children`) but nothing
downstream consumes it: the render path is **root-only rigid instancing** — one `GlobalTransform`
matrix per drawable, packed as a per-instance vertex attribute (`material-plugin.ts` queue →
`instance-layout.ts` pack → `pbr.wgsl` `VsIn`). Bones are attachment anchors, not deformers. Every
phase below is gated on the one before it.

## Why moving a bone does nothing today (the starting point)

- **No skinning attributes.** `JOINT_INDEX`/`JOINT_WEIGHT` are deliberately absent from
  `MeshAttribute` (`packages/engine/src/mesh/vertex-attribute.ts`); the glTF importer *skips*
  `JOINTS_0`/`WEIGHTS_0` (`packages/gltf/src/mesh-mapping.ts`).
- **No skin extraction.** `node.skin` and `skin.inverseBindMatrices` are in the schema but never read
  (`packages/gltf/src/schema.ts`, `gltf-root.ts`).
- **No palette, no skinning math** in any WGSL shader. The vertex shader applies a single model matrix
  to every vertex.
- **Propagation already works** (`packages/engine/src/hierarchy.ts` — gated propagation recomputes a
  moved bone and all descendants), so the bone's `GlobalTransform` *does* update. Nothing reads it.

## Phases

Dependency-ordered milestones. Each becomes one or more `docs/backlog/*.md` items when promoted, and
its architectural decision becomes an ADR at promotion time.

**Milestone order ≠ per-frame evaluation order.** At runtime each frame the pipeline is: sample clips →
blend / layers → **retarget** (source rig → target pose) → **IK** (correct the retargeted pose, e.g.
plant feet) → compute palette → skin. IK runs *after* retargeting in the frame. But in *build* order IK
lands first (Phase 4) because it's a self-contained primitive useful on its own (foot IK, look-at on any
character) and is exactly the contact-fix mechanism retargeting then reuses — so Phase 5 leans on an IK
that already exists. The phase numbers say what to build first, not what runs first.

### Phase 0 — GPU skinning (the floor: "move a bone → mesh deforms") ✅ SHIPPED

The prerequisite for *everything* below. Nothing in Phases 1–5 is visible without it.

**Status: shipped, confirmed working in the editor 2026-06-25.** Decisions sealed in
[ADR-0114](../adr/ADR-0114-gpu-skinning-data-model-and-render-path.md) (data model + render-path split)
and [ADR-0115](../adr/ADR-0115-joint-palette-gpu-delivery.md) (storage-buffer delivery, `storageBuffers`
capability gate, WebGL2 bone-texture fallback deferred). Landed: `JOINT_INDEX`/`JOINT_WEIGHT` attributes;
glTF skin extraction (`GltfSkin`, `skins[]`, `node.skin`) + `Skeleton` attach on instantiation; the
`packages/engine/src/skinning/` module (`Skeleton`, palette compute after propagation, shared palette
storage buffer, skinned instance layout + batching, `SkinningPlugin`); the `#ifdef SKINNED` PBR variant
and the skinned render path in `material-plugin.ts`. Deferred within Phase 0: skinned + prepass, skinned
+ SSAO, the small-skeleton uniform-array path, and the WebGL2 bone-texture delivery (gated, awaits the
WebGL2 backend).

1. **Vertex attributes** — add `JOINT_INDEX` / `JOINT_WEIGHT` to `MeshAttribute` + the vertex buffer
   layout; stop skipping them in `mesh-mapping.ts`.
2. **Skin / skeleton extraction** — read `skin.joints` (ordered joint node list),
   `skin.inverseBindMatrices`, and skeleton root from glTF. New `GltfSkin`; a `SkinnedMesh` /
   `Skeleton` component on the mesh entity pointing at its ordered joint entities.
3. **Joint-palette computation** — a system (after transform propagation) computing
   `palette[i] = meshWorldInverse × jointGlobal[i] × inverseBind[i]` per skinned entity.
4. **GPU delivery** *(the one hard renderer decision)* — a **storage buffer** of joint matrices indexed
   per entity on WebGPU, with a **bone-texture fallback** for WebGL2 (no SSBOs there), gated on a
   `RendererCapabilities` flag. Small-skeleton uniform-array path optional.
5. **WGSL `#ifdef SKINNED` variant** — read joints+weights, blend palette matrices, skin position +
   normal.
6. **Render-path split** — root-only instancing **breaks** for skinned meshes (each instance needs its
   own palette, so they can't share an instance batch). Skinned draws get a per-entity bind group with
   a palette offset, separate from the rigid path in `instance-batching.ts`.

**Unlocks:** dragging a bone in the studio deforms the mesh. Nothing above this is required for that.

### Phase 1 — Clip playback (the general property-animation system) ✅ SHIPPED

**Status: shipped, confirmed working in the editor 2026-06-25.** Decisions sealed in
[ADR-0116](../adr/ADR-0116-animation-clip-data-model-and-property-path-addressing.md) (clip/track/
sampler data model, property-path addressing via reflection, LINEAR/STEP/CUBICSPLINE + shortest-path
quaternion slerp, glTF channel→track mapping with morph-weights deferred) and
[ADR-0117](../adr/ADR-0117-animation-system-home-and-player-reflection.md) (home in
`packages/engine/src/animation/`, `AnimationTarget`-id binding, reflection split, sampling in the
`update` stage so it precedes `postUpdate` propagation). Landed: the `AnimationClip` asset (`.ranim`,
via the asset-kind flow); the reflect `field-path` module shared with the inspector; glTF animation
parsing producing TRS-targeting clips + `AnimationTarget` tagging on instantiated nodes; the
`AnimationPlayer`/`AnimationTarget` components (schemas) + `AnimationPlugin` + the sampling system;
and a sampling bench. Deferred within Phase 1: morph-weight channels (await morph-target meshes),
method/event tracks (out of scope for the v1 clip format).

`AnimationClip` + `AnimationPlayer` are **not** skeletal-specific — they are the engine's general
keyframe system, the equivalent of Godot's `AnimationPlayer` and Unity's Animation window: a clip is a
set of **tracks**, each track a **reflected property path** + a sampler (keyframe times, values,
LINEAR/STEP/CUBICSPLINE). Skeletal animation is the special case where a clip's tracks happen to target
bone `Transform` translation/rotation/scale.

This leans directly on the reflection system (ADR-0060/0061): because components already declare
schemas, a track can address any reflected field by path — a material's `baseColor`, a light's
`intensity`, a sprite's atlas index, a gameplay component's field — not just transforms. That is what
makes it a "record any animatable property" system rather than a bone player, and it's the same
property-path machinery the inspector already uses.

1. **`AnimationClip` asset** — tracks (reflected property path + sampler); an asset kind via the
   `add-asset-type` flow.
2. **glTF animation parsing** → clips whose tracks target node TRS / morph weights. glTF only produces
   this subset; the clip format itself stays general.
3. **`AnimationPlayer` component + system** — sample active clips at the current time and write the
   targeted properties. When tracks target bone Transforms, skinning (Phase 0) consumes the resulting
   globals automatically. *Animation drives properties; skinning is downstream and independent.*

Method / event tracks (fire a callback at a keyframe, Godot-style) are a later add — out of scope for
the v1 clip format.

### Phase 2 — Pose pipeline (the hinge for everything Unity-like) ✅ SHIPPED

The architectural pivot. Instead of sampling *directly* into `Transform`, sampling produces a
**`Pose`** (per-bone local TRS); poses are blended; the result is committed to `Transform` once.
Decisions sealed in [ADR-0118](../adr/ADR-0118-pose-pipeline-representation-blending-and-commit.md)
(pose representation + sign-aligned nlerp blend + commit-once boundary + package-home revisit) and
[ADR-0119](../adr/ADR-0119-animation-controller-state-machine-and-blend-trees.md) (Unity-style
`AnimationController`: state machine, blend trees, transitions).

Landed: the `Pose` SoA abstraction (transient, `AnimationPoses` resource, not serialized) and the
sample → blend → commit-once path in `update` (both single-clip `AnimationPlayer` and the new
controller route bone tracks through it; non-bone tracks keep the Phase-1 direct path); weighted
blend of N poses via sign-aligned accumulated nlerp; the `AnimationController` asset (`.ranimctrl`)
unifying Bevy's blend-graph with Unity's Animator Controller — parameters, states (clip or blend-tree
motion), condition/trigger transitions with exit-time, and duration-based crossfade; 1D blend trees
plus all three Unity 2D modes (`simpleDirectional`, `freeformCartesian`, `freeformDirectional`); the
`AnimationControllerPlayer` component + `AnimationControllerRuntimes` resource; a pose-blend bench.

Deferred (Phase 3+): transition interruption (mid-crossfade), additive poses + avatar masks, and the
node-graph **editor UI** for authoring controllers (slated for a future shared node-graph package;
controllers drive via code/MCP for now). The 2D-blend math is full coverage.

Phases 3–5 all hang off this `Pose` abstraction.

### Phase 3 — Animation layers + avatar masks ✅ SHIPPED

**Status: shipped, confirmed working in the editor 2026-06-25** (a base full-body march with an
upper-body layer masked to the arms — legs stop while arms keep moving). Decisions sealed in
[ADR-0120](../adr/ADR-0120-animation-layers-avatar-masks-and-additive.md) (AvatarMask asset +
layer-stack + override/additive composition + the additive-reference-pose decision +
generic-vs-humanoid mask sequencing). Landed: the `AvatarMask` asset (`.ramask`, via the asset-kind
flow) — a binary, bone-id-keyed include set; the `AnimationLayers` component (each layer: weight,
override|additive blend, optional mask, and a clip- or controller-driven source) with transient
`AnimationLayerRuntimes` + `ReferencePoses` resources; the layered driver in `addAnimationSampling`
(shared slot layout → per-layer pose eval → masked override/additive composition → single commit);
`composeLayerOverride`/`composeLayerAdditive` in `layer-blend.ts`; and a `layer-blend` bench. Deferred
within Phase 3: the studio mask-authoring UI (drive via code/MCP for now) and an authored
reference-clip override for additive (bind pose is the default; see below).

- **`AvatarMask` asset** — a per-bone boolean set scoping which bones a layer touches.
- **Layer stack** — each layer has a weight, a blend mode (**override** vs **additive**), and an
  optional mask. Layers evaluate bottom-up; masked bones from upper layers override/add onto the
  accumulated pose (e.g. a "wave" upper-body layer masked to spine+arms, over a full-body "run").
- **Additive poses** — additive = clip pose minus a reference/bind pose; needs a reference pose to
  subtract against.

The Unity humanoid **body-part mask** (head/arms/legs toggle) is deferred to Phase 5 — it needs the
canonical humanoid avatar retargeting introduces, and then resolves to the same bone-id include set.

Pure `Pose` math — no new GPU work beyond Phase 0.

### Phase 4 — IK ✅ SHIPPED

**Status: shipped, confirmed working in the editor 2026-06-25** (two-bone arm/leg IK reaching a
target with pole-controlled bend and a 0→1 weight blend over the FK pose, a CCD spine chain, and a
head look-at, all demonstrated live on the Biker rig). Decisions sealed in
[ADR-0121](../adr/ADR-0121-inverse-kinematics-constraints-and-post-pass.md) (solver set +
schedule ordering + constraint-component model + target/pole representation + weight blending).
Landed: the `packages/engine/src/animation/ik/` module — `TwoBoneIK` (analytic law-of-cosines limb
solver with pole hint + reach clamping), `IkChain` (CCD N-bone chain), `LookAtConstraint` (aim with
up/twist reference), each a reflected schema-registered component (§13); the `ik-solve` system slotted
`{ after: ['transform-propagation'], before: ['skinning-compute-palettes'] }` with per-constraint
weight blending over the FK pose and affected-chain re-propagation via the new
`recomputeWorldSubtree` helper in `hierarchy.ts`; `IkPlugin` (added by `CorePlugin` after
`AnimationPlugin`); and an `ik-solve` bench. The broader IK/constraint space (FABRIK backend,
Full-Body IK, Spline IK, per-joint limits, foot grounding, the procedural rig-constraint family) is
backlogged in `docs/backlog/ik-and-rig-constraints.md`.

- Runs as a **post-pass after pose application, before the skinning palette**. Ordering is the delicate
  part: sample+blend → write local TRS → propagate to globals → IK adjusts globals/locals and
  re-propagates affected chains → compute palette.
- Building blocks: two-bone IK (limbs, foot IK), CCD for longer chains, look-at / aim. Each
  is an IK-constraint component + a system slotted into that ordering.

**Open questions resolved (see ADR-0121):**
- *Schedule ordering* — one `postUpdate` system after `transform-propagation`, before
  `skinning-compute-palettes`; affected chains re-propagated in place via `recomputeWorldSubtree`
  because the frame's gated propagation has already run.
- *Solver coverage* — analytic two-bone (limbs/foot/hand) + CCD (N-bone chains) + look-at/aim.
  CCD over FABRIK because the skeleton is a rotation hierarchy (CCD outputs joint rotations directly);
  FABRIK deferred.
- *Target & pole representation* — nullable **entity** references (parentable/animatable); a `null`
  pole keeps the current FK bend plane. Per-constraint `weight` blends IK over the FK pose;
  `TwoBoneIK.targetRotationWeight` orients a planted foot/hand. Bones referenced by entity (the
  `Skeleton` holds joint entities). This is the contact-pinning seam Phase 5 reuses.

### Phase 5 — Animation retargeting ✅ SHIPPED (pending editor confirmation)

**Status: shipped 2026-06-25, pending editor confirmation.** Decisions sealed in
[ADR-0122](../adr/ADR-0122-animation-retargeting-rig-mapping-and-contact-pinning.md) (retargeting
model + clip-production-over-per-frame-component + rig-mapping abstraction + rotation/translation
transfer + IK contact pinning + humanoid body-part mask resolution). Landed: the
`packages/engine/src/animation/retarget/` module — the canonical `HumanoidSlot` profile + body-part
groups + bone-name auto-map; the `RetargetRig` rig-description asset (`.rerig`, Unity-Avatar /
Unreal-IK-Rig analogue) with `buildHumanoidRetargetRig` auto-map; the pure `retargetClip` transform
(rest-relative local-space rotation transfer + height-scaled hip translation) producing **native
clips** that ride the existing animation + IK stack; `humanoidBodyPartMask` (resolving the Phase-3
humanoid body-part mask deferral); `bindRetargetRig`; `RetargetPlugin` (added by `CorePlugin` after
`IkPlugin`); and a `retarget` bench (bones × keyframes). Deferred: the cross-orientation world-space
transfer (current local-space form is exact for same-bind-orientation rigs), Unity-style muscle space,
a runtime/live-mirror retarget player, and the studio retarget UI (drive via code/MCP for now).

Play a clip authored for skeleton A on differently-proportioned skeleton B. Depends on Phase 2 (poses)
and Phase 0 (skeleton); **strengthened by Phase 4** — proportion differences make hands/feet drift, so
contact is fixed with foot/hand IK (Unity calls this out explicitly; Unreal's retargeter has dedicated
IK chains for exactly this).

Two industry models, both validated by research — we pick one (or a hybrid) at promotion time:

- **Normalized / humanoid (Unity Mecanim):** map each skeleton's bones to a canonical humanoid rig and
  store/evaluate animation in a normalized **muscle space**, with muscle limits preventing unnatural
  bends. Any humanoid clip plays on any humanoid avatar. Heavyweight, human-only, needs a per-model
  avatar/rig description; great for a large shared humanoid clip library.
- **Chain-based (Unreal IK Rig + IK Retargeter):** define retarget chains (spine, arms, legs, root) on
  source and target rigs; copy **rotation** from the source animation, choose a **translation mode**
  (target bind pose vs animation scaled by proportions), and use IK chains to pin hands/feet. More
  general (not human-only), more explicit setup.

The needed primitive either way is a **rig-mapping abstraction** (canonical bone slots / named retarget
chains) plus rest-pose-relative rotation transfer and special-cased root/hip translation. This is
mostly `Pose` math layered on the same pipeline.

## Open questions

- **Joint-palette delivery threshold** — uniform-array (small skeletons) vs storage buffer (WebGPU) vs
  bone-texture (WebGL2 fallback); at what joint count does each path engage, and what's the capability
  gate? (Carried over from `gltf.md`.)
- **Animation system home** — *resolved (ADR-0117, reaffirmed by ADR-0118 §"package home"):* stays in
  `packages/engine/src/animation/`. Phase 2 revisited extraction and **deferred again** — the layer is
  inescapably coupled to engine core types and `CorePlugin` owning `AnimationPlugin` (before any `gltf`
  build) means extracting forces `engine ↛ animation` with no Phase-2 benefit. Revisit when animation
  gains a non-engine consumer or sheds the engine-core dependency.
- **Pose representation** — *resolved ([ADR-0118](../adr/ADR-0118-pose-pipeline-representation-blending-and-commit.md)):*
  per-bone local TRS as **SoA `Float32Array`s** (`t`/`s` ×3, `r` ×4) addressed by slot, held in the
  transient `AnimationPoses` resource (not a component, not serialized — §13 derived state). Poses touch
  change detection only at the commit boundary (`markChanged(Transform)`); blend weights are tracked
  per-field per-slot so partial coverage is correct without masks.
- **Retargeting model** — *resolved ([ADR-0122](../adr/ADR-0122-animation-retargeting-rig-mapping-and-contact-pinning.md)):*
  the **chain-based / rig-mapping abstraction** (canonical `HumanoidSlot`s, a `RetargetRig`
  rig-description asset = Unity Avatar / Unreal IK Rig), **not** Unity muscle space (deferred,
  human-only). Crucially, retargeting ships as **clip production** (`retargetClip` → a native
  `AnimationClip`), not a per-frame component, so retargeted clips compose with the existing
  controllers / blend trees / layers / IK rather than forming a parallel playback path. The humanoid
  body-part mask deferred from Phase 3 resolves over the same slots (`humanoidBodyPartMask`).
- **Additive reference pose** — *resolved ([ADR-0120](../adr/ADR-0120-animation-layers-avatar-masks-and-additive.md)):*
  the **glTF bind pose** (each bone's local rest TRS), captured lazily the first frame a bone appears
  in a layered player and held in the transient `ReferencePoses` resource. Chosen over an authored
  reference clip because it is always present in a rigged glTF (zero authoring), is the natural neutral
  a breath/lean delta is relative to, and doubles as the rest base for additive bones no lower layer
  animated. A per-layer authored-reference-clip override is left as a future addition.
- **Reflection** — *Phase 1 resolved (ADR-0117):* `AnimationPlayer` (clip/speed/playing/repeat) and
  `AnimationTarget` (id/player) are authored and registered; the `AnimationPlayer.time` cursor is
  transient (`.skip()`); `AnimationClip` is an asset (serializer, not a component schema). Still open
  for later phases: layer/mask config, IK constraints, rig-mapping assets. Transient poses and the
  computed palette are deliberately *not* serialized. *Phase 2 resolved (ADR-0119):*
  `AnimationControllerPlayer` (controller/speed/playing/parameters) is authored and registered;
  `AnimationController` is an asset; the state-machine runtime (active state, crossfade, phase) is
  transient in `AnimationControllerRuntimes`.

## Links

- `docs/roadmap/gltf.md` — Phase B "Skins / GPU skinning" + "Animation clips" promote into this file
- `docs/roadmap/renderer.md` — Phase 11.5/11.6 (skinning + animation), the origin of this work
- ADR-0057 §12 (reserved skins/animations + capability-gated delivery), ADR-0060/0061 (reflection),
  ADR-0102 (hot reload)
- Source the floor sits on: `packages/engine/src/mesh/vertex-attribute.ts`,
  `packages/gltf/src/{mesh-mapping.ts,schema.ts,gltf-root.ts,gltf-instantiate.ts}`,
  `packages/engine/src/hierarchy.ts`, `packages/engine/src/material/{material-plugin.ts,instance-batching.ts,instance-layout.ts}`
- Bevy skinning + animation (shape reference): <https://docs.rs/bevy/latest/bevy/animation/index.html>
- glTF 2.0 skins/animations: <https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#skins>
- Unity humanoid retargeting / muscle space: <https://docs.unity3d.com/Manual/Retargeting.html>,
  <https://docs.unity3d.com/Manual/MuscleDefinitions.html>
- Unreal IK Rig + IK Retargeter: <https://dev.epicgames.com/documentation/en-us/unreal-engine/ik-rig-animation-retargeting-in-unreal-engine>
