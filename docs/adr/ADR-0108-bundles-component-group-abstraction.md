# ADR-0108: Bundles — a named, introspectable component-group abstraction

- **Status:** Accepted
- **Date:** 2026-06-21

## Context

Spawning multiple components together already works: `World.spawn` takes variadic
and array forms, and the engine ships informal "bundles" as factory functions
(e.g. `Camera2d()` / `Camera3d()` in `packages/engine/src/camera/camera-bundles.ts`)
that return `readonly object[]` to spread into a spawn. These are invisible to
tooling — not named, not enumerable, carrying no defaults the studio can read or
present. The reflective inspector and the Add-Component palette, by contrast,
already enumerate and edit *single* components off the type registry.

We want a Bundle to be a first-class, introspectable group of components with
optional per-property default values, listed in the studio palette next to
components and stamped onto an entity in one step — authored two ways: in code
(like Bevy) and as a user-created project asset (like a `.remat` material).

## Decision

- **A bundle is a pure authoring-time template, not a live link.** Spawning a
  bundle stamps fresh, independent component instances onto an entity; the entity
  keeps no reference to the definition. Editing a spawned entity never feeds back
  to the bundle, and editing a bundle never retroactively changes already-spawned
  entities. This keeps the runtime trivial — there is no bundle identity on
  entities and nothing bundle-specific in a saved scene.
- **One canonical representation: `SerializedValue[]`.** A `BundleDefinition`
  stores its components as `{ type, version, data }` — the same shape scenes and
  material assets use. A code-defined bundle and a `.rebundle` asset therefore
  share one form, and a `.rebundle` file is the on-disk mirror of the in-memory
  definition (no per-component encode/decode to read or write the file). Asset
  handles round-trip by GUID; a bundle component may not reference an entity.
- **Two authoring sources, one registry.** `App.registerBundle(name, components,
  opts?)` encodes live instances into a definition (code path); `.rebundle` assets
  deserialize into definitions at project load. Both populate the per-App
  `AppBundleRegistry`, which tooling reads.
- **Bundles are not components and carry no reflection schema** (CLAUDE.md §13).
  They never live on an entity and are never serialized into a scene — only the
  components they stamp are, and those are already registered. The `.rebundle`
  asset gets its own serializer (kind `Bundle`); no new un-schema'd component is
  introduced.
- **Insertion is one undoable step.** The studio's `AddBundleCommand` inserts all
  of a bundle's components via a single `World.insertBundle` (one archetype
  transition) and removes them on undo — distinct from a sequence of
  `addComponent` commands.

## Consequences

- Easier: bundles are enumerable and presentable; the palette lists code and
  asset bundles together; required-component expansion is free (`insertBundle`
  resolves `static requires`); no scene-format change.
- Accepted trade-offs: a bundle is a one-shot stamp — there is no "update all
  instances of this bundle" because there is no live link (a deliberate
  simplification the project chose). `AddBundleCommand`'s undo removes the
  bundle's component types unconditionally, matching `addComponent`'s revert: if a
  bundle overwrote a component the entity already had, undo removes it rather than
  restoring the prior value. A code-defined bundle's asset-handle field persists
  only if the handle is GUID-backed (same constraint as scenes/materials).

## Implementation

- `packages/engine/src/bundle/bundle-definition.ts` — `BundleDefinition`, `BundleRegisterOptions`
- `packages/engine/src/bundle/bundle-registry.ts` — `AppBundleRegistry`
- `packages/engine/src/bundle/bundle-codec.ts` — `bundleEncodeEnv`, `bundleDecodeEnv`, `encodeBundleComponents`
- `packages/engine/src/bundle/instantiate.ts` — `instantiateBundle`
- `packages/engine/src/bundle/bundle-asset.ts` — `BUNDLE_ASSET_KIND`, `BUNDLE_ASSET_EXTENSION`, `BUNDLE_FORMAT_VERSION`, `serializeBundle`, `deserializeBundle`, `createBundleSerializer`
- `packages/engine/src/bundle/bundle-plugin.ts` — `BundlePlugin`
- `packages/engine/src/index.ts` — `App.registerBundle`; constructor inserts `AppBundleRegistry`
- `packages/editor-sdk/src/edit/command.ts` — `AddBundleCommand`, `BundleComponentEntry`
- `packages/editor-sdk/src/edit/apply.ts` — `addBundle` apply/revert
- `packages/editor-sdk/src/edit/emitter.ts` — `createInstanceEmitter` (detached-instance write boundary, used by the studio bundle editor)
- `apps/studio/src/project/project-scene.ts` — `loadProjectBundles`; `BundlePlugin` in `loadProjectScene`
- `apps/studio/src/composer/*` — the Entity Composer (create / add / bundle modes); consumer-side, not governed by this ADR
