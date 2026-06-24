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

## Phase 2 — Stable node addressing

To attach to "the `hand.R` bone" and have it survive a reload, an authored entity needs to reference a glTF node by something **stable across re-instantiation**, not by the entity id the reactor happens to mint this run.

- Define an asset-relative node anchor: glTF node **index** (canonical) plus **name path** (human-facing, survives node reordering within reason). `GltfInstanceNodes` already exposes `nodeEntities` (by index) and `findByName` / `findAllByName`.
- A resolver: given a `GltfSceneRoot` entity + an anchor, return the live instantiated node entity (after instantiation completes).
- Editor affordance: selecting a node in the instantiated subtree exposes its anchor (so "parent under this" can record it).

## Phase 3 — Attach + round-trip (ADR)

The hard part, and where the real serialization design lives.

- An authored entity parented into the instantiated subtree serializes with its parent expressed as a **node anchor on the owning `GltfSceneRoot`**, not a raw entity id (which dangles, since the bone is excluded/derived).
- On load: spawn authored entities, instantiate the glTF, then **rebind** each anchored attachment to the resolved node entity (an ordering dependency — attachments wait for `GltfInstanceNodes`).
- The engine serializer's composition-exclusion (`collectComposition`, today hardcoded to `SceneRoot`/`SceneInstance`) likely needs a **plugin-extensible seam** so `gltf` registers its exclusion + anchor re-emission without `engine` importing `gltf`. This is the ADR-worthy decision (mirrors the nested-`SceneRoot` round-trip, generalized).
- Decide teardown / re-instantiation semantics: changing the `GltfSceneRoot` handle should re-instantiate and re-bind surviving attachments.

Until Phase 3 lands, treat the instantiated subtree as view-only: assign a model, see it, position the whole thing via the root's `Transform` — but don't author into the subtree expecting it to persist.
