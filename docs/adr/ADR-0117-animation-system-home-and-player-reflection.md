# ADR-0117: Animation system home, player binding, and reflection split

- **Status:** Accepted
- **Date:** 2026-06-25

## Context

ADR-0116 fixes the clip/track/sampler data model and property-path addressing. Three
integration decisions remain, all flagged as open questions in the skeletal-animation
roadmap:

1. **Where does the animation system live** — `packages/engine` or a new
   `@retro-engine/animation` package?
2. **How does an entity-agnostic clip bind to concrete bones** of a specific rig instance?
3. **What is authored (reflected) versus transient** on the playback components
   (CLAUDE.md §13)?

The animation system needs the engine's asset-registration helpers, `Transform`, `Time`,
the schedule, and the Phase-0 skinning hook. The glTF package (`@retro-engine/gltf`) already
depends on `@retro-engine/engine` and must produce `AnimationClip`s, so the clip type must
live somewhere glTF can import without a dependency cycle.

## Decision

**Phase 1 lives in `packages/engine/src/animation/`, not a new package.** The system is
tightly coupled to engine-owned facilities (asset kinds, `Transform`, `Time`, scheduling,
skinning), and `gltf` → `engine` dependency direction means the `AnimationClip` type must be
in `engine` for the importer to build clips. A dedicated `@retro-engine/animation` package is
**deferred to Phase 2** (the pose pipeline), when blend trees / state machines give the
extraction real surface area to justify the boundary. This is a sequencing/cost call, not a
scope cut. `AnimationPlugin` is added by `CorePlugin` so the `AnimationClips` store always
exists before any glTF plugin's `build` pulls it.

**Binding is by `AnimationTarget` id (Bevy `AnimationTargetId` shape).** A clip is a shared,
entity-agnostic asset: its tracks name a `targetId` string. The `AnimationTarget { id, player }`
component tags an entity as the bone a track addresses, scoped to a specific `AnimationPlayer`
entity. glTF instantiation tags every spawned node with `AnimationTarget` (id = node document
index, player = scene-root mount) when the model carries clips, so a clip resolves to concrete
bones the frame they spawn. Sampling rebuilds the `(player, id) → entity` map each frame, so a
freshly instantiated rig binds with no cache invalidation.

**Reflection split (CLAUDE.md §13):**
- `AnimationPlayer` clip-binding config — `clip`, `speed`, `playing`, `repeat` — is **authored
  state with a schema**. Its `time` cursor is **transient** (`.skip()`), recomputed each frame.
- `AnimationTarget` — `id`, `player` — is **authored** and registered, following the Phase-0
  `Skeleton` precedent for entity-referencing components attached to instantiated nodes.
- `AnimationClip` is an **asset**, serialized through its `.ranim` serializer, not a component
  schema.

**Sampling runs in the `update` stage.** The fixed stage order places `update` before
`postUpdate` transform propagation — a hard guarantee, stronger than a `before` label
constraint and one that leaves the `postUpdate` propagation/visibility/skinning order
untouched (a `before: ['transform-propagation']` edge would, given the schedule's
topological tie-break, defer propagation behind the visibility systems that depend on it).
So a clip driving bone `Transform`s deforms the skinned mesh the same frame: sample (update)
→ propagate `GlobalTransform` (postUpdate) → skinning palette compute (postUpdate, after
propagation).

## Consequences

- One fewer package to publish/version in Phase 1; the move to `@retro-engine/animation` in
  Phase 2 is a mechanical relocation behind the same public exports.
- Clips are instance-independent: the same `AnimationClip` plays on every instantiated copy
  of a rig, and a hand-authored clip targets any entity that carries a matching
  `AnimationTarget`.
- Rebuilding the binding map every frame is O(targets); acceptable for Phase 1 and replaced
  by a cached resolution if profiling demands it. The per-frame *sampling* cost (the part
  that grows with tracks × active clips) is benched.
- Running in `update` means user gameplay systems registered after the engine's plugins see
  the animated pose within the same frame and can override it before propagation — a
  reasonable "animation is the baseline, gameplay overrides" default.
- An auto-tagged `AnimationTarget` carries an entity field (`player`) on derived nodes; this
  follows the shipped `Skeleton` pattern and round-trips through the derived-entity baseline
  the same way.

## Implementation

- `packages/engine/src/animation/animation-player.ts` — `AnimationPlayer`, `AnimationTarget`,
  `RepeatMode`.
- `packages/engine/src/animation/animation-system.ts` — `addAnimationSampling`,
  `advancePlayerTime`.
- `packages/engine/src/animation/animation-plugin.ts` — `AnimationPlugin` (asset kind/store/
  serializer/loader registration, component schemas, sampling system).
- `packages/engine/src/core-plugin.ts` — adds `AnimationPlugin` after `SkinningPlugin`.
- `packages/gltf/src/gltf-instantiate.ts` — tags spawned nodes with `AnimationTarget`.
- `packages/gltf/src/gltf-plugin.ts` — threads the `AnimationClips` store into the importer.
