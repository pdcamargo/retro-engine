---
'@retro-engine/engine': minor
'@retro-engine/editor-sdk': minor
---

feat(engine): bundles — a named, introspectable component-group abstraction

Per ADR-0108, a Bundle is a named group of components with optional per-property default values — the engine's introspectable equivalent of a Bevy bundle. A bundle is a pure authoring-time template: spawning it stamps fresh, independent component instances onto an entity, with no live link back to the definition.

A `BundleDefinition` stores its components as `SerializedValue[]` (the same `{ type, version, data }` shape scenes and `.remat` materials use), so code-defined and asset-authored bundles share one representation and a `.rebundle` file is the on-disk mirror of the in-memory definition.

**New engine surface:**

- `App.registerBundle(name, components, opts?)` — register a code-defined bundle from live component instances; their authored field values are captured.
- `AppBundleRegistry` — per-App registry of `BundleDefinition`s (created with the App); tooling reads it.
- `BundleDefinition`, `BundleRegisterOptions`, `instantiateBundle(app, def)` — build fresh, independent instances ready for `World.insertBundle`.
- `.rebundle` asset type: `BUNDLE_ASSET_KIND`, `BUNDLE_ASSET_EXTENSION`, `BUNDLE_FORMAT_VERSION`, `serializeBundle`, `deserializeBundle`, `createBundleSerializer`, and `BundlePlugin` (registers the serializer).
- `bundleEncodeEnv`, `bundleDecodeEnv`, `encodeBundleComponents` — codec envs (handles round-trip by GUID; entity refs rejected).

**New editor-sdk surface:**

- `AddBundleCommand` (+ `BundleComponentEntry`) — inserts a whole bundle's components in one `World.insertBundle` (a single archetype transition and a single undo step); undo removes them.
- `createInstanceEmitter` — an `EditEmitter` that writes edits into a detached component instance (no world / no history), so the reflective property inspector can edit values outside the ECS (e.g. a bundle draft).

Bundles are not components and carry no reflection schema — they never live on an entity and are never serialized into a scene; only the components they stamp are.
