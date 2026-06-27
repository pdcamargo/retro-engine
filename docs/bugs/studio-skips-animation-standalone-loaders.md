# Studio skips AnimationPlugin's standalone asset loaders

`AnimationPlugin.build()` registers its `AssetServer`-dependent pieces inside an
`if (server !== undefined)` guard (`packages/engine/src/animation/animation-plugin.ts`):
the `.ranim` / `.ranimctrl` / `.ramask` loaders **and** the `Animation` sub-asset
store. In the studio, `AnimationPlugin` (via `CorePlugin`) builds during `App`
construction, **before** `AssetPlugin` adds the `AssetServer` (done later in
`installProjectRuntime`). So the guard is false and all of those registrations
are silently skipped.

Consequence: in the studio, loading a standalone `.ranim` / `.ranimctrl` /
`.ramask` asset by GUID fails with "no loader registered". (The `Animation`
sub-asset store half of this was worked around for ADR-0127 by registering it in
`GltfPlugin.build()`, which runs after the server exists — but the standalone
loaders remain unregistered.)

## Likely fix

Make `AnimationPlugin`'s server-dependent registrations happen once the server
exists regardless of plugin order — e.g. move them into the plugin's `finish()`
hook (which runs after every plugin has built), or have the studio add
`AssetPlugin` before `CorePlugin`. A `finish()`-based approach is the more
general fix and would also let the sub-asset-store registration return to
`AnimationPlugin` instead of living in `GltfPlugin`.

Note: scene-load resolves handle GUIDs eagerly, so whichever fix is chosen must
register before the project scene loads (the standalone-loader path and the
sub-asset path share this timing constraint).
