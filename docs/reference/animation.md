# Animation — current state

Covers `packages/engine/src/animation/`, `skinning/`, `morph/`, `rig/`, `proxy/`, and the 2D
sprite-animation path in `sprite/`.

**Shape to know up front:** this is the most complete corner of the engine — a full skeletal +
property animation stack with tests and real systems: clips, players, a Unity-Animator-style
controller (state machine + nested blend trees + layers + masks), IK, humanoid retargeting, GPU
skinning, morph targets, and the MakeHuman-derived "RetroHuman" character pipeline. The main hole is
**authoring UI** — clips come from data/glTF import; there is no dope-sheet/curve editor yet
(that's an editor gap, see [`studio-editor.md`](studio-editor.md)).

---

## Clips & players

- ✅ **Animation clips** (ADR-0116/0117) — `AnimationClip` = duration + tracks; `AnimationTrack` =
  `TrackTarget` (targetId + component + `FieldPath`) + `KeyframeSampler`; property-path addressing;
  `.ranim` asset. `AnimationPlayer`/`AnimationTarget` components; sampling system runs before transform
  propagation. `AnimationPlugin` added by CorePlugin.
- ✅ **Pose pipeline** (ADR-0118) — SoA `Float32Array` poses (`AnimationPoses` resource, transient, not
  serialized), `pose-blend`, `finalizePose`, `commitPoseToTransforms`, additive/override composition,
  commit-once boundary.

## Controller (state machine, blend trees, layers, masks)

- ✅ **Controller** (`.ranimctrl`, ADR-0119 → superseded by ADR-0140) — Unity-Animator-shaped
  `AnimationController`: parameters (float/bool/trigger), states, transitions/conditions,
  `stepController`/`stateWeights`, `AnimationControllerPlayer`.
- ✅ **Blend trees** (ADR-0140) — 1D/2D; **nested/recursive** (a blend-tree child holds a full nested
  `Motion`).
- ✅ **Layers & avatar masks** (ADR-0120/0141) — `AnimationLayers` (override/additive, per-layer mask);
  `AvatarMask` (`.ramask`, humanoid body-part masks); controller-owned layers (base layer = the
  controller's own state machine at full weight).
- ✅ **On-disk** (ADR-0142) — `.ranimctrl`/`.ranim`/`.ramask` encode as YAML.

## IK & retargeting

- ✅ **Inverse kinematics** (`animation/ik/`, ADR-0121) — two-bone, CCD, look-at/aim solvers
  (`IkChain`/`TwoBoneIK`/`LookAtConstraint`); one `postUpdate` `ik-solve` system between propagation and
  skinning, solves in world space, re-propagates affected chains only.
- ✅ **Retargeting** (`animation/retarget/`, ADR-0122/0125/0127) — chain-based humanoid rig mapping;
  retargeting is **clip production (bake)**, not per-frame; `RetargetRig` (`.rerig`); shared canonical
  T-pose deviation transfer; auto-retarget of foreign clips on bind (reference pose derived from bind
  bone directions; hip motion scaled by hip-height proportion).
- 🟡 **Deferred** — Unity muscle-space authoring, broader IK (FABRIK, more rig constraints)
  (backlog/animation-authoring-and-retargeting-extensions.md, backlog/ik-and-rig-constraints.md).

## Skinning & morph targets

- ✅ **GPU skinning** (`skinning/`, ADR-0114/0115) — `JOINT_WEIGHT`/`JOINT_INDEX` attributes, `Skeleton`
  (ordered joint refs, serialized), joint-palette delivery via shared storage buffer (per-instance
  `joint_offset`) with uniform/texture fallback where `storageBuffers` is false.
- ✅ **Morph targets** (`morph/`, ADR-0129/0130/0131/0132) — GPU morph delivery via storage buffers
  (`storageBuffers`-gated), batching, weights, sparse targets, OBJ base-mesh, MakeHuman `.target`
  ingestion, CPU compose + bake-to-static. 🟡 disk persistence of baked characters deferred
  (backlog/baked-character-persistence.md).

## RetroHuman / character pipeline

- ✅ **RetroHuman** (`rig/` + `proxy/`, ADR-0130–0134) — MakeHuman CC0 base mesh + 53-bone `game_engine`
  rig; vertex-order-preserving OBJ loader (so `.target` aligns), CPU morph composition, bake to static
  mesh, **garment proxy fitting** (barycentric, faithful to `.mhclo`). Engine imposes no canonical
  skeleton; foreign clips reach it via retargeting. The initiative shipped in full.
- 🟡 **RetroHuman dedicated editor** — planned (roadmap/retrohuman-editor.md): isolated preview,
  textured + sliders, Save → bake mesh + GLB export (needs a GLB *exporter* — the engine has an importer
  only, backlog/baked-character-persistence.md).

## 2D sprite animation

- ✅ **Atlas animation** (`sprite/atlas-animation.ts`, ADR-0033) — `AtlasAnimation` component +
  `atlasAnimationSystem` ticking `TextureAtlas.index` (loop/once/pingPong, fps). Separate from the
  skeletal path.

## Related gaps (tracked elsewhere)

- ❌ **Clip / dope-sheet / curve editor** — no UI to author `AnimationClip` keyframes; see
  [`studio-editor.md`](studio-editor.md) and the roadmap.
- 🟡 **Controller live-debug** in the Animator during play (backlog/animation-controller-live-debug.md).
- 🟡 **`animController.*` MCP commands** (backlog/animation-controller-mcp-commands.md).
- ❌ **Timeline / cutscene sequencer** — planned (roadmap MASTER-ROADMAP editor section).
