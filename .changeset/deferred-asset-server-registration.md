---
'@retro-engine/engine': patch
'@retro-engine/gltf': patch
---

fix(engine): register animation asset loaders independent of plugin order

`AnimationPlugin` registered its `.ranim` / `.ranimctrl` / `.ramask` loaders and
the `Animation` sub-asset store inside an `if (server !== undefined)` guard. Since
`CorePlugin` (which adds `AnimationPlugin`) is added in the `App` constructor —
before any `AssetPlugin` — the guard was false in every configuration, so those
registrations were silently skipped. In the studio this meant standalone
animation assets failed to load with "no loader registered", and the sub-asset
path only worked via a workaround in `GltfPlugin`.

New `App.whenResource(ctor, callback)` runs a callback as soon as a resource is
available — immediately if already present, otherwise the moment it is inserted.
`AnimationPlugin` now defers its server-dependent registrations through it, so
they happen regardless of plugin order and before any scene loads. The
`GltfPlugin` sub-asset-store workaround is removed.
