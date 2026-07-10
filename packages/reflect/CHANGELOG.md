# @retro-engine/reflect

## 0.1.0

### Minor Changes

- 2324f9f: feat(engine): persist edits to derived (instanced) entities as automatic overrides

  Per ADR-0113 (supersedes ADR-0112). Editing an instantiated glTF model's nodes —
  hiding a child, renaming a bone, nudging a transform, adding/removing a
  component, deleting a node — now survives save/reload, with no manual anchoring:
  the user edits a derived entity like any other and the deltas round-trip.

  A subtree's pristine state is snapshotted at instantiation (`CompositionBaseline`,
  runtime-only). On save, each derived entity is diffed against it and only the
  changes are recorded on the mount as `SerializedEntity.derived[]`
  (`set` field-level patches / `add` / `remove` / `deleted`), addressed by stable
  anchor — derived entities are still excluded as full entities. On load, the model
  re-instantiates and a generic engine system re-applies the deltas once a matching
  resolver reports the subtree ready.

  **New public surface:**

  - `@retro-engine/reflect`: `diffComponent`, `FieldOverride` — field-level encoded
    diff producing only the changed fields.
  - `@retro-engine/engine`: `CompositionBaseline` / `CompositionBaselineEntry`,
    `PendingCompositionOverrides`, `CompositionResolver` /
    `CompositionResolverRegistry` (load-time `kind`-keyed resolution seam),
    `SerializedDerivedOverride` + `SerializedEntity.derived`.
  - `@retro-engine/gltf`: `addGltfBaselineCapture`; `GltfNodeAnchor.primitive`
    (addresses per-primitive mesh children); `GltfInstanceNodes.derivedEntities`.

  **Behaviour changes:**

  - The glTF composition provider now excludes every entity the model produced
    (node entities **and** per-primitive mesh children), and registers a
    `gltf-node` resolver. A model swap drops the baseline so it is recaptured
    against the new model. An untouched instance serializes byte-identically to
    before. `CorePlugin` inserts `CompositionResolverRegistry` and registers the
    generic `composition-override-apply` system; the glTF attachment rebind now
    runs after it.

- 8e4574a: feat(engine): live plugin swap for hot code reload

  Per ADR-0102, the engine can now swap a project's plugins on a **running** App,
  so a studio can hot-reload code edits without a page reload (overrides ADR-0091's
  deferral; ADR-0091's open-project = reboot decision stands).

  **`@retro-engine/engine`:**

  - `App.removeUserPlugins(baseline)` — drop every `'user'`-origin system (purging
    its per-system buffers), unregister the components/resources the project added
    beyond `baseline`, and remove its `category() === 'user'` plugins.
  - `App.addPluginsHot(plugins)` — add plugins to a running App, bypassing
    `addPlugin`'s `Building`-only guard; each `build()` runs attributed to its
    plugin, then `ready`/`finish`/`cleanup` fire once.
  - `StageSystems.remove(pred)` — remove matching systems from a stage and
    invalidate the topo cache.
  - `SerializeOptions.filter` — serialize only the entities a predicate keeps (e.g.
    the user scene, excluding an editor's infra entities).

  **`@retro-engine/reflect`:**

  - `TypeRegistry.unregister(ctor)` — remove a registered type (by name + ctor) so a
    reloaded plugin's rebuilt classes can re-register under the same names.

  The swap preserves world data via serialize → rebuild → respawn against the
  name-keyed registry. Removing user-registered global observers / component hooks
  on swap is a tracked follow-up.

- a896a3b: feat(reflect): discriminated-union `t.variant` field kind — ADR-0063

  The codec's `FieldKind` vocabulary had no way to describe a discriminated union, so authored fields like a tagged `{ kind }` config or a "named-preset-or-custom" value could not round-trip. `t.variant(tag, arms, opts?)` adds one:

  - **Tagged mode** (default) — each arm names a field schema and carries the discriminant `tag`; encodes as `{ [tag]: armName, ...payload }`. Infers the tagged discriminated union.
  - **String-or-struct mode** (`{ stringArms: true }`) — payload-less arms serialize as bare strings and the single arm with a payload is an untagged object, for `'center' | … | { x; y }`-shaped unions.
  - An arm whose discriminant names no schema arm is omitted on encode, restoring the field's constructor default on load — the home for union arms that carry runtime-only references.

  Additive: existing schemas and scene files are unaffected. ADR-0060 stays sealed.

- 690c811: feat(reflect): reflection type names default to `ctor.name` (ADR-0088)

  `RegisterOptions.name` is now optional across `registerType` / `registerComponent` /
  `registerResource`. Resolution order is explicit `name` → static `typeName` → `ctor.name`;
  registration throws only for a truly anonymous class. An explicit `name` is still
  supported and is the right choice for namespacing (`"mygame/Player"`) or rename-safety.

  `ctor.name` stability is now a build-configuration guarantee rather than a hand-written
  string: component-producing builds keep identifier minification off (the studio bundle
  uses `--minify-whitespace --minify-syntax`; engine packages ship name-stable via `tsc`).
  Empirically, only `--minify-identifiers` mangles names, and Bun's `--keep-names` is a
  no-op today (oven-sh/bun#25332). Existing explicit-name registrations are unchanged.

- da1f0eb: feat(reflect): reflection + serialization v1 — TypeRegistry, typed field-type vocabulary, world↔scene JSON round-trip

  Per ADR-0060. Adds the new `@retro-engine/reflect` package and a world/scene serializer in `@retro-engine/engine` — the keystone for scenes/prefabs, save/load, and a future inspector.

  `@retro-engine/reflect`:

  - A `TypeRegistry` keyed by an explicit **stable name** (a registration option or a static `typeName`, never the class name — class names die under minification).
  - The typed `t` field-type vocabulary — `number` / `string` / `boolean`, `array` / `tuple` / `struct` / `enum`, `vec2` / `vec3` / `vec4` / `quat` / `mat4`, `color`, `entity`, `handle(assetType)`, and `type(Ctor)` for nested registered values. A schema's static type and runtime descriptor stay in sync: a missing, renamed, or mistyped field is a compile error. Field-type modifiers `.optional()` / `.nullable()` / `.nullish()` / `.skip()` / `.default()` / `.meta()`.
  - Field introspection (`RegisteredType.fields`, `readField` / `writeField`) and a JSON value codec (`encodeComponent` / `decodeComponent`) with per-type `version` + ordered `migrations`.

  `@retro-engine/engine`:

  - `serializeWorld` / `deserializeScene` (+ `SceneData`). Deserialize is two-phase — every entity is spawned empty first so entity-reference fields remap to freshly-spawned entities — and resolves asset handles by GUID through a caller-injected resolver.

  Reflection registration is one-time and serialization is on-demand (not per-frame), so no benchmark is added. Decorators, change-detection-by-name, the studio inspector, resources-as-reflectable, scene composition, and engine-component retrofit are reserved (see ADR-0060).

- bcef667: feat(engine): scene-aware selective asset streaming

  Per ADR-0100, a scene now loads only the assets it references — on demand as it
  decodes — instead of a whole-manifest preload, and a scene swap releases the
  assets the outgoing scene held that the incoming one does not.

  **`@retro-engine/reflect`:**

  - `collectHandleRefs` / `collectComponentHandleRefs` + the `HandleRef` type — a
    resolver-free walker that enumerates the `{ assetType, guid }` of every `handle`
    field in serialized data without decoding it. Mirrors `decodeValue`'s structural
    recursion (array, tuple, struct, nested `type`, variant). Pure reflect
    infrastructure: no new field-type vocabulary, no component registration.

  **`@retro-engine/engine`:**

  - `collectSceneHandleRefs(registry, sceneData)` — walks a whole scene (entity
    components, resources, template overrides, nested scene refs) into a
    de-duplicated `HandleRef[]`.
  - `spawnScene`'s default handle resolver now loads on demand: it prefers
    `AssetServer.loadByGuid` (reserves the handle immediately, streams the value in,
    idempotent) for any GUID the server can resolve, falling back to the App's
    populated `AssetStores` for assets added directly. Only the assets a scene
    references load. Backward-compatible — callers that still bulk-preload keep
    working (`loadByGuid` is idempotent).
  - `AssetServer.hasGuid(guid)` — whether the server can resolve a GUID (in the
    manifest or already loading).
  - `AssetServer.unloadByGuid(guid)` — drop an asset from its store (queuing its
    `removed` event) and forget its handle, so a later load re-reads it.
  - `unloadUnusedAssets(server, registry, outgoing, incoming)` — the unload half of
    a scene swap: a stateless set-diff that releases the outgoing-only assets while
    the incoming delta loads on demand and shared assets stay resident.

- 73fdef4: feat(engine): skeletal-animation Phase 1 — clip playback (general property-animation system)

  Per ADR-0116 and ADR-0117, the engine gains a general keyframe-animation system: a clip is a
  set of tracks, each a **reflected property path + a keyframe sampler**, so a clip can animate
  any reflected field — bone `Transform`s, a light's `intensity`, a material color. Skeletal
  animation is the case where tracks target bone TRS; the Phase-0 skinning path then deforms the
  mesh automatically from the animated `GlobalTransform`s.

  **`@retro-engine/reflect`** — property-path machinery moves here as the shared source of truth
  for "what an inspector edits" and "what a clip animates":

  - `FieldPath` / `FieldPathSegment`, `readPath`, `writePathLeaf`, `pathKeyOf` — relocated from
    `editor-sdk` (which now re-exports them).
  - `resolveFieldType(schema, path)` — walks a registered schema to the leaf `FieldType`, so a
    caller learns a property's `kind` (and thus how to interpolate it) from its address.

  **`@retro-engine/engine`** — new `animation/` module:

  - `AnimationClip` asset (`.ranim`, registered via the asset-kind flow): `duration` + `tracks`,
    each track a `TrackTarget` (`targetId` + component name + `FieldPath`) and a `KeyframeSampler`
    (times/values/`componentCount`/interpolation).
  - `sampleInto` — pure LINEAR / STEP / CUBICSPLINE sampler; quaternion tracks use shortest-path
    spherical interpolation, vectors/scalars linear, with the glTF CUBICSPLINE tangent layout.
  - `AnimationPlayer` (clip handle + `speed`/`playing`/`repeat`; transient `time` cursor) and
    `AnimationTarget` (`id` + `player`) components, both with reflection schemas.
  - `AnimationPlugin` (added by `CorePlugin`) + the sampling system, which advances each player and
    writes its clip's tracks into the bound entities. Runs in the `update` stage, before
    `postUpdate` transform propagation, so a clip driving bone `Transform`s deforms the skinned
    mesh the same frame.

  **`@retro-engine/gltf`** — glTF `animations` are parsed into `AnimationClip`s whose tracks target
  node TRS (`Gltf.animationClips`); instantiation tags spawned nodes with `AnimationTarget` so a
  clip binds to the spawned bones. Morph-weight channels are parsed but skipped pending
  morph-target mesh support.

  **`@retro-engine/editor-sdk`** — `edit/field-path` re-exports the path machinery from `reflect`
  (no behaviour change; one source of truth).

### Patch Changes

- e163274: fix(engine): keep entity references out of derived-subtree overrides (fixes dead skinning on scene reload)

  A glTF instance's bones are _derived_ entities — rebuilt with fresh ids each time the model
  re-instantiates on load. The derived-override system (which persists edits to instanced subtrees)
  assumed glTF node components carry no entity fields, but GPU skinning later added `Skeleton` whose
  `joints` are an entity array into that subtree. The result: the override baseline encoded the joints
  as `-1`, the save-time diff saw the live ids as a change and persisted `Skeleton` as a phantom
  override, and on load that override decoded against an empty entity remap — zeroing every joint. The
  skinned mesh then stayed in its bind/T-pose no matter what drove the bones.

  The fix treats entity references as unrepresentable in derived overrides (their targets are rebuilt,
  so the ids can never round-trip):

  - **`@retro-engine/reflect`** — new `schemaHasEntityField` / `fieldHasEntityRef` walk a schema for any
    entity-typed field (through arrays, tuples, structs, variants, and nested registered types).
  - **Capture** (`serialize.ts`) — a derived entity's entity-bearing components are no longer diffed or
    flagged for removal; they are left to the mount's provider to rebuild, so nothing phantom-persists.
  - **Apply** (`composition-apply.ts`) — a persisted override targeting an entity-bearing component is
    skipped, so scenes saved before this fix self-heal: the re-instantiated `Skeleton` stands instead of
    being clobbered with zeroed joints.

- e6728cc: fix(reflect): coerce + validate numbers in decodeValue

  `decodeValue` for a `number` field returned the value unchanged, so a numeric
  string (an editor / MCP field-set may pass `"0.15"`) flowed through to consumers
  unchanged — and a string in an `f32` material uniform threw deep in the render
  loop. It now coerces a numeric string to a number and throws a clear error for a
  non-numeric value, so a bad value fails fast at decode rather than poisoning a
  downstream GPU uniform packer.

- Updated dependencies [937f2cb]
- Updated dependencies [d5424c3]
- Updated dependencies [c1b257b]
- Updated dependencies [2ea4d68]
- Updated dependencies [6e1d04c]
- Updated dependencies [5ea3e80]
- Updated dependencies [2f22822]
- Updated dependencies [62e382e]
- Updated dependencies [1280e03]
- Updated dependencies [fad8a5e]
- Updated dependencies [3db9d87]
- Updated dependencies [ac35dac]
- Updated dependencies [67e8513]
- Updated dependencies [f8079c6]
- Updated dependencies [5c33631]
- Updated dependencies [acae153]
- Updated dependencies [8934a75]
- Updated dependencies [2beee52]
- Updated dependencies [5cf81f9]
  - @retro-engine/assets@0.1.0
  - @retro-engine/ecs@0.1.0
  - @retro-engine/math@0.1.0
