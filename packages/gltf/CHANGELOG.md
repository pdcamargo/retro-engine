# @retro-engine/gltf

## 0.1.0

### Minor Changes

- b315044: feat(engine): asset-kind registry + on-discovery `.meta` sidecar generation

  Per ADR-0111. `.meta` sidecars are the source of truth for asset identity, but they were only ever written by a project save — so a loose asset dropped into a project (a `.glb`, an image) never gained a GUID, never entered the manifest, and never appeared in the studio asset browser. This adds the discovery half: a central catalog of asset kinds plus a pure pass that mints sidecars for loose source assets.

  **New public surface:**

  - `AssetKinds` — main-world resource cataloguing every asset kind; `registerAssetKind(app, descriptor)` registers one in a plugin's `build()`.
  - `AssetKindDescriptor` — declares a kind's tag, claimed `extensions`, whether it is `discoverable` (loose files get a sidecar minted), an optional `largeBinary` hint, a UI `category` string, and an optional `defaultMeta()` factory for the sidecar `data` body.
  - `generateMissingSidecars(files, kinds)` — pure, idempotent function returning the `.meta` writes for loose discoverable assets lacking a sibling sidecar (no I/O; callers write through an `AssetSink`). `GenerateSidecarsResult`, `MintedSidecar`.
  - `AssetMetaFile.data` (+ `AssetMetaData`, `bakeMetaWithData`, `parseMeta`) — optional additive per-kind metadata body on the sidecar (wire version stays 1).
  - `@retro-engine/gltf`: `GLTF_ASSET_KIND`, `gltfAssetKindDescriptor` — the glTF/GLB kind descriptor (discoverable, `model` category), registered by `GltfPlugin`.

  **Behaviour:**

  - The engine's built-in kind-owning plugins (image, mesh, scene, bundle, sprite, material) now register an `AssetKindDescriptor`. Images and glTF are discoverable; engine-authored outputs (`.rmesh`/`.rescene`/`.rebundle`/`.remat`) are catalogued but not discovered.
  - No change to the save path or manifest scan; `data` is additive and `scanMetaManifest` is untouched.

- 1b66f35: feat(animation): auto-retarget foreign clips on bind

  Assigning an animation clip authored for one model to a rig instantiated from a different model now Just Works — no retarget UI, no authoring step. When a clip-bearing component (`AnimationPlayer`, `AnimationControllerPlayer` motions, `AnimationLayers` clip sources) resolves a clip whose skeleton differs from the entity's rig, the engine retargets it to that rig by bone name, at assign time and again on scene load. A clip native to the rig's model is untouched.

  The scene stores only the original clip reference (`"<modelGuid>#AnimationN"`); the retargeted clip is derived, cached, and never persisted, so reload re-derives it.

  **New public surface:**

  - `@retro-engine/engine`: `EffectiveClips` (+ `EffectiveClipsView`, `effectiveClip`) — a transient resource the sampler resolves every clip through, so a foreign clip plays its retargeted form without rewriting the authored handle. Inserted by `AnimationPlugin`; empty (a no-op) unless a retarget path populates it.
  - `@retro-engine/gltf`: `buildHumanoidRetargetRigFromGltf(gltf, name?, opts?)` — builds a source `RetargetRig` straight from a loaded glTF document; `addGltfAutoRetarget(app)` — the bind-time reactor that detects foreign clips, retargets, caches by `(sourceClipGuid, targetRigSignature)`, and feeds `EffectiveClips`. Registered by `GltfPlugin`.

  Foreign detection compares the clip's origin model GUID against the rig's `GltfSceneRoot` model (falling back to track-id intersection for non-glTF rigs); a source model still loading suppresses the clip rather than playing it mis-targeted, so an in-flight load never flickers a wrong pose.

  Also fixes scene loading of a persisted model-clip reference: `GltfPlugin` now registers the `Animation` sub-asset store (so `"<modelGuid>#AnimationN"` resolves at scene-load time in hosts that add the `AssetServer` after the core plugins), and the auto-retarget system captures the target rig after composition overrides are applied.

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

- bb91444: feat(gltf): map glTF primitives/materials/images onto engine assets

  Adds the data-mapping layer that turns a decoded glTF document into engine assets, building on the parser/decoder. `@retro-engine/gltf` now depends on `@retro-engine/engine` (plus `renderer-core` and `math` for HAL/vector types), consumed through their public entry points.

  **Public surface (`@retro-engine/gltf`):**

  - `mapGltfAssets(document, buffers, ctx, stores, decoder)` — orchestrator that maps every mesh, material, and image in a document, registering each as a labeled sub-asset (`Mesh{i}/Primitive{j}`, `Material{i}`, `Image{n}`) via `ctx.addLabeledAsset`. Returns `MappedGltfAssets` (`meshes` / `materials` / `images` handle tables) — the input a glTF root asset wires into its scene graph.
  - `mapPrimitiveToMesh` — primitive → `Mesh`. Attribute semantics `POSITION/NORMAL/TEXCOORD_0→UV_0/TANGENT/COLOR_0→COLOR`; VEC3 `COLOR_0` expanded to VEC4; indices promoted `u8→u16`, kept `u16`/`u32`; `TEXCOORD_1`/`JOINTS_0`/`WEIGHTS_0` recognised and skipped. No coordinate/winding conversion.
  - `mapPrimitiveMode` — primitive draw mode → `PrimitiveTopology`; LINE_LOOP / TRIANGLE_FAN are rejected (no WebGPU topology).
  - `mapMaterialToStandardMaterial` — full pbrMetallicRoughness → `StandardMaterial`, including `normalScale`, occlusion strength, emissive (factor + texture), alpha mode + cutoff, and `doubleSided` → cull. glTF factor defaults (`metallic`/`roughness` = 1) applied explicitly. Per-slot color space: base-color/emissive `srgb`; normal/MR/occlusion `linear`.
  - `createImageResolver` — resolves texture images to deduped `Image` sub-assets: one handle per unique `(source, color space, sampler)`; a source reused under a divergent sampler or color space is duplicated. `mapSampler` maps glTF wrap/filter enums to `SamplerDescriptor`.
  - `ImageDecoder` / `DecodedImagePixels` / `createImageBitmapDecoder` — the injected image-decode port (PNG/JPEG). The package bundles no codec; the default decoder runs in the browser / webview and any environment supplies its own. KTX2 is recognised but its decode stays deferred.

  The `Gltf` root asset, node/scene types, `GltfPlugin`, importer registration, and instantiation are a separate, following slice.

- 1c4a0fe: feat(gltf): attach authored entities onto instantiated glTF nodes, round-tripped through saves

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

- 782c7f8: feat(gltf): new `@retro-engine/gltf` package — in-house glTF 2.0 / GLB parser

  Stands up the publishable `@retro-engine/gltf` leaf package and its from-scratch parsing layer, with no runtime parsing dependency. This is the foundation the mesh/material mapping and scene-instantiation layers build on.

  **New public surface:**

  - `parseGltf(bytes)` — parse a `.glb` binary container or a loose `.gltf` JSON document into a `ParsedGltf` (`{ document, bin? }`), validating the asset version and the required-extension contract.
  - `readGlb(bytes)` / `isGlb(bytes)` / `GlbContainer` — GLB container reader: 12-byte header validation (magic, version 2, length) and chunk walking (JSON first, optional BIN), with clear errors.
  - `decodeAccessor(document, buffers, index)` → `DecodedAccessor` — decodes every component type into a flat typed array, expands normalized integers to `float32`, honors `byteOffset`/`byteStride` (interleaved layouts), and reconstructs sparse accessors.
  - `resolveBuffers(document, bin, read)` / `sliceBufferView(...)` / `SiblingReader` — resolve every buffer (external sibling via the injected reader, embedded `data:` URI, or GLB BIN chunk) and slice bufferViews, bounds-checked.
  - `detectImageMime(bytes, hint?)` → `SupportedImageMime` — classify an image by `mimeType`, URI extension, or magic bytes (`image/png`, `image/jpeg` for v1; `image/ktx2` recognized).
  - `GltfImportError` / `GltfErrorCode` — the validation/error contract: bad GLB magic/version, malformed JSON, unsupported required extension, missing/out-of-bounds buffer/bufferView/accessor, and unsupported image MIME.
  - The glTF 2.0 JSON schema types (`GltfDocument`, `GltfAccessor`, `GltfMesh`, `GltfMaterial`, …) for the v1 subset.

  Mesh/material mapping, the `Gltf` root asset, and the `GltfPlugin` instantiation reactor are not included here.

- 18d91c3: feat(gltf): Gltf root asset + node→entity instantiation

  Completes glTF v1: the importer assembles decoded meshes/materials/images into a `Gltf` root asset and registers itself so `AssetServer.load('model.gltf')` (and `.glb`) works through the standard load-drain path, and a reactor mirrors a scene's node graph as a navigable, named entity tree.

  **New public surface (`@retro-engine/gltf`):**

  - `Gltf` root asset — `scenes`/`namedScenes`/`defaultScene`, `meshes`/`namedMeshes`, `materials`/`namedMaterials`, `images`, `nodes`/`namedNodes` — plus the `GltfNode` (TRS `Transform`, children, optional mesh), `GltfScene`, `GltfMesh`, and `GltfPrimitive` shapes, and the `Gltfs` store.
  - `GltfPlugin({ material, decoder? })` — registers the `gltf` / `glb` importer (closing over the engine's `Meshes` / `Images` stores and the `StandardMaterial` material plugin's store) and installs the instantiation reactor. `decoder` defaults to the browser `createImageBitmap` decoder.
  - `GltfSceneRoot { handle, scene? }` — marks an entity for instantiation. The reactor spawns the chosen scene's node graph as a child subtree (each node a `Transform` + a `Name` when named; single-primitive mesh nodes carry `Mesh3d` + `MeshMaterial3d`, multi-primitive nodes become an anchor with one child entity per primitive).
  - `GltfInstanceNodes` — recorded on the root after instantiation: the node-index→`Entity` array plus `findByName` / `findAllByName` for named-node / bone lookup.
  - `buildGltfRoot`, `createGltfImporter`, `addGltfInstantiation` for advanced/custom wiring.

  **Breaking (within the unreleased package):** the raw glTF-JSON schema types `GltfNode` / `GltfScene` / `GltfMesh` / `GltfPrimitive` are no longer re-exported from the package entry — those names now belong to the root-asset types. The JSON document type `GltfDocument` (and its other field types) remain exported.

- beff5bc: feat(gltf): register `GltfSceneRoot` as a serializable component bound to a `Gltf` handle store

  `GltfPlugin` now binds the `Gltfs` store under the `Gltf` asset-type key and registers `GltfSceneRoot` with a reflection schema (`handle: Handle<Gltf>`, optional `scene`). This makes a glTF model assignable through a handle field and lets a scene that references one persist the mount and re-instantiate its node graph on load — the foundation for spawning glTF models from an editor rather than only programmatically.

  The instantiated subtree a `GltfSceneRoot` expands into stays derived (rebuilt by the reactor on load); only the `GltfSceneRoot` itself serializes.

  **New public surface:**

  - `GLTF_ASSET_KIND` re-exported as the handle store key for `GltfSceneRoot.handle`.
  - `GltfSceneRoot` gains a registered schema; no API shape change to the class.

- 707714f: feat(engine): animate morph-target weights from glTF morph channels

  glTF `weights` animation channels now drive a `MorphWeights` component, and the
  animation system can sample a number-array leaf.

  - `@retro-engine/gltf`: `mapAnimations` maps a `weights` channel to a track on the
    node's `MorphWeights` (`path: weights`), deriving the per-keyframe component
    count (target count) from the input/output accessor lengths (`× 3` for
    `CUBICSPLINE`). Previously these channels were dropped.
  - `@retro-engine/engine`: `applyTrack` handles an `array` leaf kind — it samples
    `componentCount` values into the array element-wise (morph-target weights),
    reusing the existing keyframe sampler. A bound `AnimationPlayer` now animates a
    mesh's blend-shape weights over time.

  (Studio inspector also renders one `[0,1]` slider per morph target name — apps-only,
  no package change.)

- d25c7aa: feat(engine): morph-target data layer — `MorphWeights`, `MorphTargets`, glTF blend-shape import

  The CPU/data half of runtime morph targets (glTF blend shapes), per ADR-0129. No GPU render
  path yet — this lands the asset shapes, the authored component, and the import wiring so a glTF
  with morph targets round-trips into the world with addressable weights.

  **New public surface (`@retro-engine/engine`):**

  - `MorphTarget` / `MorphTargets` — a mesh's static blend-shape delta store: named per-vertex
    position + normal deltas (NORMAL zero-filled when absent), parallel default weights. Attached to
    a `Mesh` via the new optional `Mesh.morphTargets` field.
  - `MorphWeights` — authored component holding live per-target weights addressable by name
    (`names` / `weights`, `get` / `set` / `indexOf`, `MorphWeights.fromTargets`). Reflection schema
    registered by `MorphPlugin`, so it survives saved scenes and code reloads.
  - `MorphPlugin` — registers the component; added to `CorePlugin` after `SkinningPlugin`.

  **`@retro-engine/gltf`:**

  - `mapPrimitiveToMesh` now decodes `primitive.targets` (POSITION/NORMAL deltas) into
    `Mesh.morphTargets`, naming targets from `mesh.extras.targetNames` and seeding default weights
    from `mesh.weights`. TANGENT deltas are ignored (the PBR shader needs no per-vertex tangent).
  - Instantiation attaches a `MorphWeights` to morphing mesh nodes (single- and multi-primitive).

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

- e8c703e: fix(engine): register animation asset loaders independent of plugin order

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

- Updated dependencies [45c51aa]
- Updated dependencies [1b9b7f5]
- Updated dependencies [7d40c1a]
- Updated dependencies [937f2cb]
- Updated dependencies [b315044]
- Updated dependencies [d5424c3]
- Updated dependencies [e0c4984]
- Updated dependencies [15617ff]
- Updated dependencies [ab6e7b9]
- Updated dependencies [1b66f35]
- Updated dependencies [0baa8a9]
- Updated dependencies [7142f6f]
- Updated dependencies [2c27d90]
- Updated dependencies [7e26e59]
- Updated dependencies [e73d32e]
- Updated dependencies [9c36012]
- Updated dependencies [12eb41d]
- Updated dependencies [773fabd]
- Updated dependencies [afc904c]
- Updated dependencies [3b3cf7f]
- Updated dependencies [2c27d90]
- Updated dependencies [a9837c6]
- Updated dependencies [f8079c6]
- Updated dependencies [e8c703e]
- Updated dependencies [8029403]
- Updated dependencies [2324f9f]
- Updated dependencies [294c161]
- Updated dependencies [597b913]
- Updated dependencies [6e1d04c]
- Updated dependencies [5ea3e80]
- Updated dependencies [2f22822]
- Updated dependencies [62e382e]
- Updated dependencies [5d7a21a]
- Updated dependencies [8d36fd7]
- Updated dependencies [3b04954]
- Updated dependencies [9e2aaf5]
- Updated dependencies [1280e03]
- Updated dependencies [fdde82f]
- Updated dependencies [9d41f83]
- Updated dependencies [056bfc9]
- Updated dependencies [1cdff13]
- Updated dependencies [1c76eef]
- Updated dependencies [d8b7fc2]
- Updated dependencies [5ea3e80]
- Updated dependencies [68963c6]
- Updated dependencies [be766a4]
- Updated dependencies [bc7640e]
- Updated dependencies [cad5613]
- Updated dependencies [4741039]
- Updated dependencies [4ca7beb]
- Updated dependencies [0bc6ca5]
- Updated dependencies [e163274]
- Updated dependencies [5317052]
- Updated dependencies [5599db7]
- Updated dependencies [5988cb6]
- Updated dependencies [a055d25]
- Updated dependencies [2a7a18b]
- Updated dependencies [da51d57]
- Updated dependencies [c2732c5]
- Updated dependencies [fad8a5e]
- Updated dependencies [1c4a0fe]
- Updated dependencies [c4bf47a]
- Updated dependencies [7812b83]
- Updated dependencies [8e4574a]
- Updated dependencies [be4aad1]
- Updated dependencies [0eca147]
- Updated dependencies [88d0fc5]
- Updated dependencies [01070b1]
- Updated dependencies [b788a60]
- Updated dependencies [a3b6d83]
- Updated dependencies [43cae6c]
- Updated dependencies [90a56e2]
- Updated dependencies [88d3ca3]
- Updated dependencies [68ce298]
- Updated dependencies [b5e3322]
- Updated dependencies [10bda28]
- Updated dependencies [ca1cafa]
- Updated dependencies [e97fdd2]
- Updated dependencies [3db9d87]
- Updated dependencies [0c7b778]
- Updated dependencies [781aa88]
- Updated dependencies [7142f6f]
- Updated dependencies [eb3c452]
- Updated dependencies [e6728cc]
- Updated dependencies [8029403]
- Updated dependencies [d63d0f9]
- Updated dependencies [c049410]
- Updated dependencies [707714f]
- Updated dependencies [3658119]
- Updated dependencies [ac35dac]
- Updated dependencies [3280a8e]
- Updated dependencies [62effe1]
- Updated dependencies [ca677c6]
- Updated dependencies [abbd55c]
- Updated dependencies [67e8513]
- Updated dependencies [8ac39a9]
- Updated dependencies [92d6c91]
- Updated dependencies [f8079c6]
- Updated dependencies [75a1a8a]
- Updated dependencies [e6728cc]
- Updated dependencies [a896a3b]
- Updated dependencies [5be634a]
- Updated dependencies [690c811]
- Updated dependencies [da1f0eb]
- Updated dependencies [056bfc9]
- Updated dependencies [7dc7bca]
- Updated dependencies [5c33631]
- Updated dependencies [fa2678b]
- Updated dependencies [67e8513]
- Updated dependencies [836a7ab]
- Updated dependencies [ea56975]
- Updated dependencies [6fbb29d]
- Updated dependencies [d25c7aa]
- Updated dependencies [4015d71]
- Updated dependencies [82ecdec]
- Updated dependencies [bcef667]
- Updated dependencies [c26f7a3]
- Updated dependencies [7b8eeea]
- Updated dependencies [8a6fb8f]
- Updated dependencies [9712180]
- Updated dependencies [bc24cd2]
- Updated dependencies [f45c5f0]
- Updated dependencies [824b04f]
- Updated dependencies [47372a5]
- Updated dependencies [73fdef4]
- Updated dependencies [88c4629]
- Updated dependencies [93f4053]
- Updated dependencies [ba77627]
- Updated dependencies [f2f082b]
- Updated dependencies [641b263]
- Updated dependencies [7812b83]
- Updated dependencies [48686b4]
- Updated dependencies [f0584f2]
- Updated dependencies [bc634ae]
- Updated dependencies [f95bac1]
- Updated dependencies [7dddd6f]
- Updated dependencies [a0fb8d4]
- Updated dependencies [59d37c2]
- Updated dependencies [7142f6f]
- Updated dependencies [acae153]
- Updated dependencies [8934a75]
- Updated dependencies [f55bffb]
- Updated dependencies [b1a1e01]
- Updated dependencies [5b52805]
- Updated dependencies [dd3de07]
- Updated dependencies [d8c0bda]
- Updated dependencies [b10dc50]
- Updated dependencies [05d2bb6]
- Updated dependencies [0f8701d]
- Updated dependencies [7f40ed1]
- Updated dependencies [591fdef]
- Updated dependencies [42d7275]
- Updated dependencies [b2a610d]
- Updated dependencies [2beee52]
- Updated dependencies [5cf81f9]
- Updated dependencies [ce20898]
- Updated dependencies [823e5cd]
  - @retro-engine/engine@0.1.0
  - @retro-engine/renderer-core@0.1.0
  - @retro-engine/reflect@0.1.0
  - @retro-engine/ecs@0.1.0
  - @retro-engine/math@0.1.0
