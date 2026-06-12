---
'@retro-engine/engine': minor
---

feat(engine): scene composition — nest scenes inside scenes (ADR-0071)

A parent scene can now include other scenes as nested entities — the live-link (Godot instanced-scene / Unity nested-prefab) model, the deliberate opposite of ADR-0067's baked template refs. The child stays an independent, editable asset addressed by GUID; saving the parent re-emits the reference, not the child's expanded entities.

**New public surface:**

- `SerializedSceneRef` — `{ guid: string }`, a nested child-scene reference.
- `SerializedEntity.scene?` — an optional ref on any scene entity (the "mount"). Additive and optional, so `SCENE_FORMAT_VERSION` stays `1` and existing scenes round-trip byte-identically.

**Behaviour:**

- `spawnScene` turns a `scene` ref into a `SceneRoot` on the mount entity (resolving the child handle via a caller-injected `resolveHandle` or, by default, `AssetServer.loadByGuid`, which also kicks the load). The existing instantiation reactor then expands the child under the mount and re-parents it — so the mount's own `Transform`/`Name`/`Parent` position, name, and nest the instance, and the **same child scene can be instanced many times** (one mount entity each). Nesting recurses, loading lazily one depth-level per frame.
- The reactor refuses an include cycle (a scene transitively including itself) via a `Parent`-chain ancestor-GUID walk, marking the refused mount with an empty instance instead of spawning unboundedly.
- `serializeWorld` / `serializeScene` re-emit each mount as its `scene` ref and exclude the child's instantiated entities; a mount whose handle has no GUID is runtime-only (excluded, no ref).

Per-instance field overrides *inside* a nested child (Godot "editable children") are deferred to a follow-up.
