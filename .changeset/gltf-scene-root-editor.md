---
'@retro-engine/gltf': minor
---

feat(gltf): register `GltfSceneRoot` as a serializable component bound to a `Gltf` handle store

`GltfPlugin` now binds the `Gltfs` store under the `Gltf` asset-type key and registers `GltfSceneRoot` with a reflection schema (`handle: Handle<Gltf>`, optional `scene`). This makes a glTF model assignable through a handle field and lets a scene that references one persist the mount and re-instantiate its node graph on load — the foundation for spawning glTF models from an editor rather than only programmatically.

The instantiated subtree a `GltfSceneRoot` expands into stays derived (rebuilt by the reactor on load); only the `GltfSceneRoot` itself serializes.

**New public surface:**

- `GLTF_ASSET_KIND` re-exported as the handle store key for `GltfSceneRoot.handle`.
- `GltfSceneRoot` gains a registered schema; no API shape change to the class.
