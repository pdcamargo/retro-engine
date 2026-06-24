# ADR-0112: Plugin-extensible scene composition and node anchors

- **Status:** Accepted
- **Date:** 2026-06-24

## Context

Scene composition ([ADR-0071](ADR-0071-scene-composition.md)) lets a `SceneRoot` + `SceneInstance` mount keep its instantiated child entities out of a save and re-emit a `scene: { guid }` reference instead, so the child stays an independent asset. The serializer's `collectComposition` hardcodes this to `SceneRoot`/`SceneInstance`.

glTF instantiation (the `gltf-in-editor` roadmap) raised an analogous but harder case. A `GltfSceneRoot` expands a model into a derived entity subtree (`GltfInstanceNodes`), excluded from saves and rebuilt on load. The north star is to attach an authored entity — a sword — onto a node in that subtree (the `hand.R` bone), save, reload, and have it survive without baking the model into the scene. Three problems blocked it:

1. Hierarchy round-trips through `Parent`, an entity reference. The bone is excluded from the save, so the sword's `Parent` serialized to a dangling `-1` (`buildEncodeEnv.entityId` returns `-1` for any target outside the live set).
2. The exclusion + re-emission logic the bone case needs is the same shape as `SceneRoot`, but `engine` must never import `gltf` ([CLAUDE.md §5.3](../../CLAUDE.md)), and the bone-anchoring detail is glTF-specific.
3. The bone the sword references is identified this run by an entity id the reactor happens to mint; nothing about it is stable across re-instantiation.

The exclusion was previously worked around in the studio (`save-scene` filtered `GltfInstanceNodes` members), which only addressed problem 1's exclusion half, not the dangling attachment, and put engine-shaped knowledge in the app.

## Decision

- **A plugin-extensible composition seam.** A new engine resource `CompositionRegistry` accumulates `CompositionProvider`s. A provider declares which entities it derives (`excluded(world)`) and how to re-express an authored entity's parent edge into that subtree as a stable anchor (`anchorFor(world, derived) → { mount, kind, anchor }`). The scene serializer consults the registry to extend exclusion and to translate a cross-boundary `Parent` into a serialized `attach` record. `gltf` registers a provider; `engine` never imports `gltf`.

- **The built-in `SceneRoot` case stays inline.** `serializeWorld` is a bare-world path with no `App` and therefore no registry; its `SceneRoot`/`SceneInstance` exclusion + `scene`-ref re-emission must keep working there, so it remains hardcoded in `collectComposition`. The registry is an *additive* seam consulted only on the `serializeScene` (App) path. This is the minimal generalization that does not regress the bare-world path.

- **Cross-boundary parent edges serialize as anchors, never raw entity ids.** When an authored entity's `Parent` targets an excluded entity, the serializer omits the `Parent` component and emits `attach: { to, kind, anchor }` (`to` is the mount's in-scene id — the mount is authored and serialized, so it round-trips normally). On load `spawnScene` turns `attach` into a transient `PendingAttachment` instead of a `Parent`; a `kind`-matching system resolves it once the subtree exists. This is the generalization of `SceneRoot`'s mount re-emission to the *child* side of the boundary.

- **A glTF node anchor is the canonical index plus a name path.** `GltfNodeAnchor` records the glTF node **index** (canonical identity) and, when every node from the model root down is named, the **name path**. Resolution prefers the name path (it survives node reordering on re-import — the routine skeleton case) and falls back to the index. The glTF rebind system waits for the mount's `GltfInstanceNodes`, resolves the anchor, parents the entity, and drops the `PendingAttachment`; an attachment loaded before its model simply retries.

- **Re-instantiation preserves attachments.** Swapping a `GltfSceneRoot`'s handle re-instantiates the subtree. The re-instantiation system detaches authored attachments (recording each as a `PendingAttachment` for its bone anchor) **before** despawning the old subtree — otherwise the despawn cascade through `Children` would consume them — then drops `GltfInstanceNodes` so the one-shot reactor rebuilds and the rebind system reattaches the survivors.

### Tenets this sets, to keep animation/IK clean

- **References into a derived subtree are anchors, never raw entity ids.** `Parent` gets save-time translation because it predates this rule. Future IK/constraint/look-at components reference a bone with a `{ mount: Entity, anchor: GltfNodeAnchor }` field — `mount` is a normal ref to the serialized mount, `anchor` is authored data — resolved at runtime with `resolveGltfNodeAnchor`. No further engine change is required; the anchor primitives already unblock them. (A generic `t.nodeAnchor()` reflection field type routed through the registry is a documented growth path, out of scope here.)
- **Bone transforms are derived and never persisted.** Attachment is plain `Parent` + transform propagation, so an animation- or IK-driven bone drags its attached children for free. Authoring (and saving) a bone pose is intentionally out of scope — that belongs to animation, not scene serialization.

## Consequences

- A sword attached onto a glTF bone in the studio survives save/reload and a model swap; the glTF is not baked into the scene (re-importing the model still updates it). Nested glTF (a model attached under another model's bone) works without a special case: exclusion unions every subtree, anchoring resolves to the nearest mount, and rebind is per-attachment.
- The studio's manual `GltfInstanceNodes` save filter is removed; exclusion lives in the engine serializer via the glTF provider. The studio save only filters editor infra.
- The `attach` field on `SerializedEntity` is additive and optional, so existing scenes round-trip byte-identically.
- The `engine → gltf` dependency rule holds: the engine ships the generic seam (registry, provider interface, `PendingAttachment`, `attach`), glTF ships the node-specific anchor/resolver/rebind.
- The Phase 1 one-shot reactor's "model swap means despawn + re-add" limitation is fixed: re-assigning a handle re-instantiates and re-binds.

## Implementation

- `packages/engine/src/scene/composition.ts` — `CompositionRegistry`, `CompositionProvider`, `CompositionAnchor`, `PendingAttachment`
- `packages/engine/src/scene/scene-data.ts` — `SerializedAttachment`, `SerializedEntity.attach`
- `packages/engine/src/scene/serialize.ts` — `collectComposition` (registry-aware), cross-boundary `Parent` → `attach` re-emission
- `packages/engine/src/scene/spawn.ts` — `attach` → `PendingAttachment` on load
- `packages/engine/src/core-plugin.ts` — inserts `CompositionRegistry`
- `packages/gltf/src/gltf-anchor.ts` — `GltfNodeAnchor`, `resolveGltfNodeAnchor`, `gltfAnchorForEntity`
- `packages/gltf/src/gltf-attach.ts` — `GLTF_NODE_ANCHOR_KIND`, `addGltfAttach` (composition provider + rebind system)
- `packages/gltf/src/gltf-instantiate.ts` — `addGltfReinstantiation`; `GltfInstanceNodes` source fields
- `packages/gltf/src/gltf-plugin.ts` — registers the above
- `packages/editor-mcp/src/commands/entity.ts` — `entity.anchor` command (generic over the registry)
- `apps/studio/src/project/project-scene.ts` — `installProjectRuntime`; `apps/studio/src/main.ts` calls it on project open; `apps/studio/src/project/save-scene.ts` drops the manual exclusion; `apps/studio/src/panels-inspector.ts` anchor readout
