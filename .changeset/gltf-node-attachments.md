---
'@retro-engine/engine': minor
'@retro-engine/gltf': minor
'@retro-engine/editor-mcp': minor
---

feat(gltf): attach authored entities onto instantiated glTF nodes, round-tripped through saves

Per ADR-0112, an authored entity parented onto a node in an instantiated glTF subtree (e.g. a sword on a `hand.R` bone) now survives a save/reload and a model swap, without baking the model into the scene. The parent edge into the derived subtree serializes as a stable node anchor instead of a dangling entity id.

**Engine — plugin-extensible scene composition:**

- `CompositionRegistry` (resource, inserted by `CorePlugin`) + `CompositionProvider` — a plugin declares which entities it derives (excluded from saves) and how to re-express a parent edge into that subtree as a stable anchor. Generalizes the previously hardcoded `SceneRoot`/`SceneInstance` exclusion; the built-in case stays inline for the bare-world `serializeWorld` path.
- `SerializedEntity.attach` (`{ to, kind, anchor }`) — additive and optional, so existing scenes round-trip byte-identically. The serializer emits it in place of a cross-boundary `Parent`; `spawnScene` turns it into a transient `PendingAttachment` resolved by a `kind`-matching system.

**glTF — stable node addressing + attachment round-trip:**

- `GltfNodeAnchor` (canonical node index + name path), `resolveGltfNodeAnchor`, `gltfAnchorForEntity` (resolves to the nearest mount, so nested glTF anchors to its own model).
- A composition provider (excludes instantiated nodes, re-emits attachments as anchors) and a rebind system (re-parents a `PendingAttachment` onto its resolved node once the model instantiates).
- `addGltfReinstantiation` — swapping a `GltfSceneRoot` handle re-instantiates the subtree and re-binds surviving attachments (detach-before-despawn).

**editor-mcp:**

- `entity.anchor` — returns the composition anchor of an entity inside a derived subtree (e.g. a glTF node), generic over the registry.
