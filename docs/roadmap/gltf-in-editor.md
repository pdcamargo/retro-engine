# Roadmap — glTF models in the editor

The north star: open a project, drop a character GLB into a scene, **edit into its instantiated hierarchy** (attach a sword to the `hand.R` bone, a camera to the `head`, a collider to the `root`), save, reload, and have it all survive — without baking the model into the scene file, so re-importing the GLB still updates it.

## Phase 1 — Foundation (DONE)

`GltfSceneRoot` is a registered, serializable component; `GltfPlugin` runs in the studio's project boot; the asset picker offers glTF `model` assets for a `Gltf` handle slot.

- `Add Component → GltfSceneRoot → pick a .glb` → the reactor instantiates the model's node graph as a child subtree (one entity per glTF node, `Transform` + `Name`, `Mesh3d` + material on mesh nodes), and it renders.
- The subtree is **derived**: a scene save excludes it (studio `save-scene` filters `GltfInstanceNodes` members) and persists only the `GltfSceneRoot`; on load the reactor re-instantiates.

Implemented across `packages/gltf` (`GltfPlugin`, `GltfSceneRoot` schema, `Gltf` store binding), `apps/studio` (project boot wiring, picker `Gltf` spec, save exclusion).

### Known Phase 1 limitations (the rest of this roadmap)

- The glTF subtree is **read-only** as far as persistence goes. You can select a bone and look at it, but anything you attach into the subtree (Phase 3) does not yet round-trip.
- `GltfPlugin` is wired inside `loadProjectScene`, so it only comes up when a project has a startup scene that loads. A project with no startup scene gets no glTF support until that path is hoisted. (Pre-existing shape of the asset/manifest wiring, not introduced by Phase 1.)
- Re-assigning a different glTF to a `GltfSceneRoot` that has already instantiated does not re-instantiate (the reactor is one-shot, gated on `GltfInstanceNodes` absence). Changing models means despawn + re-add today.

## Phase 2 — Stable node addressing (DONE)

An authored entity references a glTF node by something **stable across re-instantiation**, not by the entity id the reactor mints this run.

- `GltfNodeAnchor` — glTF node **index** (canonical) plus **name path** (preferred at resolve time; survives node reordering on re-import).
- `resolveGltfNodeAnchor(world, mount, instance, anchor)` returns the live node entity; `gltfAnchorForEntity(world, entity)` computes the anchor of a node, resolving to the **nearest** mount (so nested glTF anchors to its own model).
- Editor affordance: the inspector surfaces a selected node's anchor; the `entity.anchor` MCP command returns it (generic over the composition registry).

## Phase 3 — Attach + round-trip (DONE, [ADR-0112](../adr/ADR-0112-plugin-extensible-scene-composition.md))

- An authored entity parented into the subtree serializes its parent as an `attach` record (`{ to: mount, kind, anchor }`), not a raw entity id (which dangles).
- On load the entity gains a transient `PendingAttachment`; the glTF rebind system re-parents it onto the resolved node once `GltfInstanceNodes` exists (the ordering dependency).
- The engine serializer's composition-exclusion is now a **plugin-extensible seam** (`CompositionRegistry` + `CompositionProvider`); `gltf` registers its exclusion + anchor re-emission without `engine` importing `gltf`. The built-in `SceneRoot` case stays inline for the bare-world `serializeWorld` path.
- Re-instantiation: swapping the `GltfSceneRoot` handle re-instantiates and re-binds surviving attachments (detach-before-despawn so the cascade does not eat them).
- `GltfPlugin` is hoisted (`installProjectRuntime`) so glTF works in a project with no startup scene.

The roadmap's north star is met. (Per [CLAUDE.md §3](../../CLAUDE.md), this file is deleted only after explicit user confirmation that the work is done.)
