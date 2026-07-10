# @retro-engine/engine

## 0.1.0

### Minor Changes

- 45c51aa: feat(engine): Phase 10.6 — PCF / shadow filtering kernels (`ShadowFilteringMethod`)

  Per ADR-0047, layers configurable shadow filtering on top of ADR-0045's (directional + spot) and ADR-0046's (cascaded directional) shadow maps. A new `Shadow3dSettings.filteringMethod` selects the kernel `retro_engine::shadow3d` uses to sample the shadow atlas; the default `Hardware2x2` keeps existing behaviour bit-for-bit, while `Castano13` (9-tap weighted-bilinear Gaussian) and `Pcf5x5` (25-tap uniform) give softer penumbras at higher GPU cost. No new HAL, no new capability flag, no binding-model change.

  The choice is global per frame, applies to every shadowed light and every cascade, and is dispatched in WGSL from a new `GpuLights.shadow_flags` vec4 — uniform control flow is preserved, so `textureSampleCompare` stays legal in every branch. Spot lights, point lights, and the unlit path are unaffected.

  **New public surface:**

  - `ShadowFilteringMethod` — frozen const map + string-literal union: `'Hardware2x2' | 'Castano13' | 'Pcf5x5'`.
  - `Shadow3dSettings.filteringMethod` (+ option) — render-world resource field selecting the active kernel. Default `Hardware2x2`.
  - `packShadowFlags` — pure packer writing the filtering ordinal into the trailing `shadow_flags.x` slot of the lights uniform.

  **Behaviour changes:**

  - `GpuLights` grew by one trailing `shadow_flags: vec4<u32>`: the uniform buffer is now 8128 B (was 8112). `shadow_flags.x` carries the active `ShadowFilteringMethod` ordinal (0=Hardware2x2, 1=Castano13, 2=Pcf5x5); `.y/.z/.w` are reserved (zero). The `@group(2)` layout is unchanged — three bindings (lights uniform + shadow atlas + comparison sampler).
  - `Light3dPlugin`'s `light3d-prepare` packs the active method via `packShadowFlags` alongside the existing `packCounts` / `packCascadeSplits` calls.
  - `retro_engine::shadow3d` now dispatches `shadow_factor` / `directional_shadow_factor` through `sample_cascade_dispatch` and exposes `sample_cascade_castano13` / `sample_cascade_pcf5x5` kernel functions over the same `project_shadow` core. Tap spacing uses `textureDimensions(shadow_atlas).x` so the WGSL adapts to any future atlas-resolution change without re-syncing constants.

- 1b9b7f5: feat(engine): Phase 10.4 — 3D shadow maps (directional + spot)

  Per ADR-0045, extends ADR-0044's analytic 3D lighting with shadow maps for directional and spot lights. A new depth prepass renders shadow-caster mesh depth from each light's point of view into a shared `depth32float` 2D-array atlas (one layer per caster); `StandardMaterial`'s `pbr.wgsl` now multiplies each directional / spot light's contribution by a `shadow_factor` sampled from that atlas with a comparison sampler. No new HAL, no GPU capability flag.

  Existing lit scenes gain shadows automatically — `Light3dPlugin` wires the atlas, the prepass node, and the shading. The `@group(2)` lights bind group grows from one binding (lights uniform) to three (uniform + shadow atlas + comparison sampler); lit pipeline layouts pick this up transparently. Unlit materials and point lights are unaffected (point-light cube shadows are a documented follow-on).

  **New public surface:**

  - `NotShadowCaster` — marker component opting a mesh out of casting shadows (it still renders and receives). Every visible `Mesh3d` casts by default.
  - `Shadow3dSettings` — render-world resource tuning shadows: `directionalExtent` (orthographic frustum half-size), `near`, `far`, `depthBias`, `slopeScaleBias`, `cullMode`. `Light3dPlugin` inserts a default. `Shadow3dSettingsOptions` is the constructor input shape.
  - `Shadow3dState` — render-world resource owning the 2D-array depth atlas, the depth-only pipeline, per-layer light-space view-proj uniforms, and caster batches.
  - `Shadow3dPass3dNode` / `Shadow3dPass3dLabel` — Core3d render-graph node, prepended before the opaque pass, that renders caster depth into each light's atlas layer.
  - `SHADOW3D_WGSL` (`retro_engine::shadow3d`: shadow atlas + comparison sampler bindings + `shadow_factor`), `SHADOW3D_DEPTH_WGSL` (standalone depth-render shader).
  - `directionalLightViewProj`, `spotLightViewProj`, `assignCasterLayer` — pure light-space-matrix helpers (exposed for tests / benches / custom plugins).
  - `MAX_SHADOW_CASTERS` (8), `NO_SHADOW_CASTER` (-1), `SHADOW_MAP_SIZE` (1024), `SHADOW_ATLAS_FORMAT` (`depth32float`) — layout constants.
  - `packShadowViewProj`, `packDirectionalCasterIndex`, `packSpotCasterIndex` — pure packers for the new `GpuLights` shadow metadata.

  **Behaviour changes:**

  - `GpuLights` grew: the uniform buffer is now 7840 B (was 7328) with a trailing `shadow_view_proj: array<mat4x4<f32>, 8>`; each shadowed directional / spot light stores its atlas-layer index in `direction.w` / `params.w` (`-1` = unshadowed). `GpuLights.ensureInitialised` now builds a 3-entry `@group(2)` layout and no longer builds the bind group itself — `Shadow3dState.ensure` builds it (via the new `GpuLights.buildShadowBindGroup`) once the atlas + comparison sampler exist.
  - `Light3dPlugin` now requires a `RenderGraphPlugin` (it injects the shadow node into the Core3d sub-graph) and runs two new systems: `shadow3d-prepare` (Prepare) and `shadow3d-queue` (Queue).
  - Up to 8 shadow-casting lights per frame (directional first, then spot, in visible order); extras render unshadowed. The directional frustum is a fixed orthographic box around the world origin (cascades add camera fitting in a later stage).

- 7d40c1a: feat(editor-sdk): asset context-action registry + inline create/rename, and asset lifecycle plumbing

  Adds an extensible pattern for asset-browser context-menu actions and the create/rename/delete flows built on it.

  **`@retro-engine/editor-sdk`:**

  - `AssetActionRegistry` (+ `createAssetActionRegistry`) and the `AssetAction` / `AssetActionContext` / `AssetActionHost` / `AssetActionTarget` / `AssetDraft` types — register actions scoped to a specific asset type/kind, all assets, or the panel (create actions). Exposed as `Editor.assetActions`.
  - `MenuEntry.submenu` (nested menus) and an exported `renderMenuEntries` shared by context menus and the menu bar.
  - `Widgets.contextMenuWindow` — a background context menu (opens on empty space, defers to per-item menus).
  - `assetCard` gained an inline editing mode (`AssetCardEditing`) for create/rename, plus `icon` / `tag` / `tone` overrides so kinds sharing one browser bucket read distinctly.
  - `Keys.Enter` and `Keys.F2`.

  **`@retro-engine/engine`:**

  - `AssetServer.loadErrorForGuid(guid)` — the sticky error from a failed load, so tooling can distinguish "failed" from "still loading".

  **`@retro-engine/editor-mcp`:**

  - `asset.create` / `asset.rename` / `asset.delete` commands, backed by new optional `CommandContext` hooks (`createAsset` / `renameAsset` / `deleteAsset`).

- 937f2cb: feat(engine): automatic GUID handle resolution for scenes

  Per ADR-0065, a saved scene now restores its asset handles by GUID with **no caller-injected `resolveHandle`**. `spawnScene(app, scene)` resolves a referenced mesh, material, sprite texture, or atlas against the assets already in their stores — closing the resolver-injection cost ADR-0064 had accepted. This is the scene-blocking slice of the persistent asset tier; the manifest, `.meta` sidecars, disk/bundle sources, and load-on-demand-by-GUID (ADR-0055 phases 4–6) remain out of scope.

  **`@retro-engine/assets`:**

  - `Assets<T>` now indexes every value by its `AssetGuid`. `add(value, guid?)` mints a fresh v4 GUID when none is supplied — so every in-memory asset is serializable and resolvable by default — or adopts an explicit one (the manifest/loader path).
  - `Assets.handleByGuid(guid)` resolves a persistent GUID back to its live store slot. `insert` indexes a GUID-bearing handle; `remove` drops it. `reserveHandle` stays GUID-less.

  **`@retro-engine/engine`:**

  - New `AssetStores` resource maps each reflection asset-type key to its owning `Assets` store; `registerAssetStore(app, key, store)` populates it from a store-owning plugin's `build`. `ASSET_TYPE` exposes the fixed-store keys (`'Mesh'`, `'Image'`, `'TextureAtlasLayout'`).
  - `spawnScene` builds the default resolver from the App's `AssetStores` when no `resolveHandle` is passed; an injected resolver still overrides. A referenced GUID absent from its store throws.
  - Material handle fields now key on a **per-class** asset type (`Materials<M>` / `Materials2d<M>`) instead of the previously-ambiguous shared `'Materials'` / `'Materials2d'`. The serialized scene stores only the GUID, so existing scenes are unaffected.

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

- d5424c3: feat(assets): LoadContext + dependency-aware loading

  Widens the importer context so a single importer can pull in related resources and register the sub-assets a composite file decodes into — the prerequisite for multi-file formats (a model with external buffers/images, an atlas with a sidecar).

  **Public surface (`@retro-engine/assets`, re-exported from `@retro-engine/engine`):**

  - `LoadContext` replaces `AssetImportContext`. It keeps `path` and adds:
    - `read(relativePath): Promise<Uint8Array>` — read a resource referenced relative to this asset, resolved against the directory of `path` and fetched through the same source the root load used. A `data:` URI is decoded inline and never hits the source. The importer awaits these reads, so an asset is not loaded until its dependencies resolve.
    - `addLabeledAsset<U>(label, value, store): Handle<U>` — register a decoded sub-asset into `store` and get its handle back to wire into the composite value. The store is passed explicitly, keeping the server asset-type-agnostic.
  - `AssetImporter<T>` now receives a `LoadContext`. The change is additive: existing single-file importers (which read only `ctx.path`) compile and behave unchanged.

  **Behaviour (`AssetServer`):**

  - `runLoad` constructs the `LoadContext`. Sibling paths resolve by string join against the path's directory (source-agnostic — no `new URL`), so a source's own base resolution composes on top.
  - Sub-assets reserve a handle immediately (no event queued) and buffer locally; on importer resolution the whole subgraph — sub-assets before root — is committed in one `PreUpdate` drain pass, before the render stage extracts any of it.
  - Failure stays all-or-nothing: a throwing importer commits no partial subgraph; reserved sub-asset slots are simply never filled; `AssetLoadFailure` records the error unchanged.

- e0c4984: feat(engine): retrofit the four asset registries onto the unified `Assets<T>` store (ADR-0055)

  Replaces the four bespoke, hand-rolled asset registries (`Images`, `Meshes`, `Materials<M>`, `TextureAtlasLayouts`) and their branded-number handle types with the generic `Assets<T>` store and object `Handle<T>` from `@retro-engine/assets`. One store implementation, one handle type, one event channel across meshes, images, materials, and atlas layouts. The draw-time key stays a `number` (`handle.index`): render caches keep their `Map<AssetIndex, RenderT>` shape and the `MeshAllocator`'s free/slice paths are unchanged, so this is a type-and-keying change, not a re-architecture of draw.

  **BREAKING — public surface changes:**

  - Branded handle types `ImageHandle`, `MeshHandle`, `MaterialHandle<M>`, and `TextureAtlasLayoutHandle` are **removed**. Handle-bearing components (`Mesh3d`, `Mesh2d`, `MeshMaterial3d<M>`, `MeshMaterial2d<M>`, `TextureAtlas`, `Sprite.image` / `.normalMap`) and material texture fields (`StandardMaterial`, `UnlitMaterial`) now hold `Handle<T>` from `@retro-engine/assets`. A `Handle<T>` is an object `{ index, guid? }`, not a number — compare with `handleEq` (or `handle.index`), never `===` on the handle, and never use a handle object as a `Map` key (key on `handle.index`).
  - The per-type change unions `ImageAssetEvent`, `MeshAssetEvent`, `MaterialAssetEvent<M>`, and `TextureAtlasLayoutAssetEvent` are **removed** in favour of `AssetEvent<T>`. `AssetEvent<T>` adds an `'unused'` variant alongside `'added' | 'modified' | 'removed'`.
  - Store method renames inherited from `Assets<T>`: `drainPendingChanges()` → `drainEvents()`; `Images.replace(h, v)` / `TextureAtlasLayouts.replace(h, v)` → `insert(h, v)` (note: `insert` on an empty slot queues `'added'` and always writes, whereas `replace` was a no-op returning `false` on an unknown handle); `Meshes.mutate(h, fn)` / `Materials.mutate(h, fn)` → `getMut(h)` then mutate the returned value in place. `iter()` now yields `[AssetIndex, T]` rather than `[Handle, T]`.
  - `Images`, `Meshes`, and `TextureAtlasLayouts` are now thin named subclasses of `Assets<T>` (the distinct constructor is what lets each coexist as a constructor-keyed ECS resource); `Materials<M>` is `extends Assets<M>` and keeps its per-type synthesized subclass machinery. The three well-known image defaults (`Images.WHITE`, `Images.BLACK`, `Images.NORMAL_FLAT`) remain seeded in the `Images` constructor, now typed `Handle<Image>`.
  - `MeshAllocator`'s `allocateVertex` / `allocateIndex` / `freeVertex` / `freeIndex` / `vertexSlice` / `indexSlice` now take an `AssetIndex` (pass `handle.index`) instead of a branded `MeshHandle`.
  - `AssetIndex` (type) and `asAssetIndex` are now re-exported from `@retro-engine/engine`.

  No behaviour change to rendering: the playground renders meshes, sprites, and materials identically, and runtime `assets.add()` / hot-mutate-via-`getMut()` drive the expected GPU updates. The persistent-GUID tier of the model is designed but not exercised by this slice.

- 15617ff: feat(engine): asset server, loaders, and AssetPlugin

  Adds the engine-side loading layer over the `@retro-engine/assets` primitives. `engine` now depends on `assets` (the dependency runs `engine → assets` only).

  **New public surface:**

  - `AssetServer` — the single load entry point. `load<T>(path)` reserves a store slot and returns a `Handle<T>` **synchronously**; the read + decode run off-schedule and their result lands in an internal completion queue. `registerLoader(extension, store, importer)` binds a file extension to a target `Assets<T>` store and an importer (the store is bound at registration because `load` is given only a path and each asset type has its own store). `reload(path)` re-reads into the existing handle (hot-reload, stable handle, queues `modified`). `load` is idempotent per path. `settle()` / `pendingCount` aid tests and loading screens — `settle` is not the load API.
  - `FetchAssetSource` — the web `AssetSource`, `fetch`-backed, with an `ok` check and optional `baseUrl`. Disk and bundle sources are injected in their own environments.
  - `AssetPlugin` — inserts `AssetServer` (with an injected or default `FetchAssetSource`) and installs the `PreUpdate` load-drain system. Not auto-added by `CorePlugin`; add it explicitly. Loaders register separately via `AssetServer.registerLoader`.
  - `applyCompletedLoads` — the drain: commits completed loads into their stores (queuing the store's `added` / `modified` event) and reports failures. Runs in `PreUpdate`, so a load finished this frame is in its store before the render stage extracts it.
  - `CompletedLoad` / `AssetLoadFailure` types.
  - Passthrough re-exports of `Assets`, `makeHandle`, `handleEq`, and the `Handle` / `AssetEvent` / `AssetSource` / `AssetImporter` / `AssetImportContext` types from `@retro-engine/assets`, so consumers of `load<T>(): Handle<T>` get the types without depending on the leaf directly.

  No existing engine behaviour changes: nothing is auto-wired and the four current asset registries (Image / Mesh / Material / atlas) are untouched.

- ab6e7b9: feat(engine): AtlasAnimation — time-driven TextureAtlas.index ticker for animated sprites

  Phase 8.4 lands the minimum viable sprite animator on top of Phase 8.2's texture-atlas data path. Per ADR-0033. A new `AtlasAnimation` component carries `{ firstIndex, lastIndex, fps, mode, paused, elapsedSec }`; a new `'atlas-animation'` system in `'postUpdate'` (ordered `before: ['atlas-sync']`) advances `TextureAtlas.index` over time on every animated entity and marks the component changed so `atlas-sync` re-writes `sprite.rect` in the same frame. Animation reads `Time.virtual.delta`, so the standard virtual-time pause/scale knobs apply uniformly.

  Mode shapes: `'loop'` wraps `firstIndex → lastIndex → firstIndex` forever; `'once'` plays through then self-pauses at `lastIndex`; `'pingPong'` ping-pongs without repeating endpoints (a 4-frame range yields `0,1,2,3,2,1,0,1,…`). Forward-only — `firstIndex > lastIndex` is silently skipped; explicit reverse playback is deferred to the full animation system (Phase 9).

  **New public surface:**

  - `AtlasAnimation` — ECS component carrying `{ firstIndex: number; lastIndex: number; fps: number; mode: 'loop' | 'once' | 'pingPong'; paused: boolean; elapsedSec: number }`. Options-bag constructor with `mode` (default `'loop'`) and `paused` (default `false`) optional. Spawn alongside `Sprite + TextureAtlas`: `cmd.spawn(new Sprite({ image }), new TextureAtlas(layout, 0), new AtlasAnimation({ firstIndex: 0, lastIndex: 7, fps: 12 }))`.
  - `AtlasAnimationOptions` — input shape for the constructor.
  - `AtlasAnimationMode` — `'loop' | 'once' | 'pingPong'`.
  - `atlasAnimationSystem` — pure system function. Registered by `SpritePlugin` with label `'atlas-animation'` and ordering `before: ['atlas-sync']`. Exposed for tests / benches / custom registration.

  **Behaviour changes (non-breaking):**

  - `SpritePlugin.build` now registers three `'postUpdate'` systems (`'atlas-animation'` → `'atlas-sync'` → `'sprite-bounds'`) instead of two. Plugins re-adding `SpritePlugin` are unaffected (insertion is idempotent).
  - Entities carrying an `AtlasAnimation` will see their `TextureAtlas.index` advance every frame the system runs. Code that previously relied on `TextureAtlas.index` being stable should either drop the `AtlasAnimation` from those entities or set `paused = true`.

- 1b66f35: feat(animation): auto-retarget foreign clips on bind

  Assigning an animation clip authored for one model to a rig instantiated from a different model now Just Works — no retarget UI, no authoring step. When a clip-bearing component (`AnimationPlayer`, `AnimationControllerPlayer` motions, `AnimationLayers` clip sources) resolves a clip whose skeleton differs from the entity's rig, the engine retargets it to that rig by bone name, at assign time and again on scene load. A clip native to the rig's model is untouched.

  The scene stores only the original clip reference (`"<modelGuid>#AnimationN"`); the retargeted clip is derived, cached, and never persisted, so reload re-derives it.

  **New public surface:**

  - `@retro-engine/engine`: `EffectiveClips` (+ `EffectiveClipsView`, `effectiveClip`) — a transient resource the sampler resolves every clip through, so a foreign clip plays its retargeted form without rewriting the authored handle. Inserted by `AnimationPlugin`; empty (a no-op) unless a retarget path populates it.
  - `@retro-engine/gltf`: `buildHumanoidRetargetRigFromGltf(gltf, name?, opts?)` — builds a source `RetargetRig` straight from a loaded glTF document; `addGltfAutoRetarget(app)` — the bind-time reactor that detects foreign clips, retargets, caches by `(sourceClipGuid, targetRigSignature)`, and feeds `EffectiveClips`. Registered by `GltfPlugin`.

  Foreign detection compares the clip's origin model GUID against the rig's `GltfSceneRoot` model (falling back to track-id intersection for non-glTF rigs); a source model still loading suppresses the clip rather than playing it mis-targeted, so an in-flight load never flickers a wrong pose.

  Also fixes scene loading of a persisted model-clip reference: `GltfPlugin` now registers the `Animation` sub-asset store (so `"<modelGuid>#AnimationN"` resolves at scene-load time in hosts that add the `AssetServer` after the core plugins), and the auto-retarget system captures the target rig after composition overrides are applied.

- 0baa8a9: feat(engine): batch system registration + `.chain()` ordering

  First slice of ECS ordering depth (ADR-0157). Adds `App.addSystems(stage, specs,
{ chain })` and the `system(params, fn, options?)` spec helper, so a group of
  systems can be registered together and — with `{ chain: true }` — run in strict
  sequence:

  ```ts
  app.addSystems(
    "update",
    [
      system([ResMut(Input)], readInput),
      system([Res(Input), ResMut(Velocity)], applyInput),
      system([Res(Velocity), ResMut(Transform)], integrate),
    ],
    { chain: true }
  ); // readInput → applyInput → integrate
  ```

  Chaining orders by **system identity** (a new internal `afterIds` edge on the
  schedule), so it composes with any `label` / `before` / `after` the systems
  already carry — unlike hand-wiring `after: ['prev-label']`, it doesn't consume a
  system's one label slot and can't false-cycle on shared labels. The topo sort
  resolves label and id edges in one pass; cycles are still caught eagerly at
  registration.

- 7142f6f: docs(engine): seal ADR-0027 — TS-side AsBindGroup equivalent (class-static schema + `MaterialSchema` helper)

  Architectural shape decision recorded in `docs/adr/ADR-0027-bind-group-schema-and-material-schema-helper.md`. Materials declare their bind-group layout as `static bindGroup = MaterialSchema(Self, [...])`. The helper closes the rename-safety gap that a raw `as const satisfies BindGroupSchema<M>` would leave open — TypeScript can only check `fieldKey: keyof M & string` when the helper binds the class reference through a generic parameter.

  Rejected alternatives:

  - **TC39 Stage-3 decorators** — `tsconfig.base.json` does not enable `experimentalDecorators`; the decorator runtime is still settling. Lands when a second consumer also wants the syntax.
  - **Registry / builder pattern** — does not deliver compile-time rename safety; less consistent with the engine's existing class-static metadata convention (`Transform.requires`, component lifecycle hooks, `ShaderRegistry`).
  - **WGSL reflection** — the Phase 4 preprocessor is text-only; no AST. Lands with a WGSL parser ADR.

  Implementation ships under `feat(engine): material system, Core3d phase trio, per-camera depth automation`.

- 2c27d90: feat(engine): optional author-facing name on blend-tree motions

  A `blend1d` / `blend2d` `Motion` may now carry an optional `name`. It is additive
  and serialized in the `.ranimctrl` YAML (omitted when absent, so unnamed trees stay
  clean and existing files are unaffected). Editors use it to label a nested blend
  tree where it appears as a child of another tree — otherwise every nested tree reads
  as a generic "1D/2D Blend Tree" and can only be identified by descending into it.

- 7e26e59: feat(engine): bundles — a named, introspectable component-group abstraction

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

- 9c36012: feat(engine): cameras, projections, render layers, and camera-driven render set (Renderer Phase 2)

  First real consumer of the render world and `RenderTarget`. Per ADR-0020, the `Render` sub-set of the `'render'` stage now runs once per active camera per frame, with a render pass opened per camera against its resolved target, viewport, and clear-config. `SortedCameras` orders cameras by `Camera.order` (off-screen targets first on ties).

  **Components & resources (`packages/engine/src/camera/`):**

  - `Camera` — `isActive`, `order`, `viewport`, `target: CameraRenderTarget`, `hdr`, `msaaWriteback`, `clearColor: ClearColorConfig`, `computed: ComputedCamera`.
  - `PerspectiveProjection` / `OrthographicProjection` — separate component classes; both updated each frame by the engine's camera system. `ScalingMode` union (`WindowSize` | `Fixed` | `AutoMin` | `AutoMax` | `FixedVertical` | `FixedHorizontal`) drives orthographic sizing.
  - `RenderLayers` — 32-bit bitmask component, default `0b1`. `renderLayersIntersect(a, b)` helper. The visibility _check_ is wired in the next phase (Visibility & CPU culling); this phase ships the component so cameras and renderables can declare layers up-front.
  - `ClearColor` — global default color resource. Cameras with `ClearColorConfig.Default` read it; `Custom(color)` overrides; `None` skips the clear.
  - `CameraRenderTarget` — engine-level tagged union (`primary` | `surface` | `texture` | `view`). `Primary` is the default target and resolves to the App's surface at frame time; render targets that fail to resolve (e.g. primary on a headless App) are dropped with a one-shot warning.
  - `SortedCameras` — per-frame resource holding the dispatch order.
  - `ViewBindGroupCache` — internal resource caching the per-camera view bind group + uniform buffer.
  - `VIEW_UNIFORM_WGSL` / `VIEW_UNIFORM_BYTE_SIZE` — WGSL snippet + struct size for the canonical view uniform (`view_proj`, `view`, `inverse_view`, `projection`, `world_position`, `viewport`).

  **Bundles:**

  - `Camera2d()` / `Camera3d()` — factory functions returning `[Camera, Projection, Transform]` tuples ready to pass to `spawn(...)`. `Camera2d` uses `near=-1000` so 2D entities at negative Z stay visible.

  **Engine wiring:**

  - `App.renderFrame()` rewritten around per-camera dispatch. The Render set runs once per active camera in `SortedCameras` order with the camera's pass open; no-camera Apps with a surface get one fallback clear-only pass, headless apps with no cameras do no GPU work.
  - `RenderContext.camera: CameraView` — per-pass view exposing the resolved render target, view/projection matrices, viewport, render-layer mask, world position, and the per-camera view bind group.
  - `AppOptions.clearColor` is now sugar for inserting a `ClearColor` resource; the resource is the canonical path.
  - `CameraPlugin` is auto-installed by `CorePlugin`. It registers `cameraSystem` in `'postUpdate'`, `extractCameras` in `RenderSet.Extract`, and `prepareCameras` in `RenderSet.Prepare`.

  **Behaviour notes:**

  - Render-stage systems registered against the default `RenderSet.Render` now fire once per camera per frame. With one camera, behaviour matches the previous single-pass shape.
  - `apps/playground` spawns a `Camera2d` at startup; existing render-stage tests were updated to do the same. Apps that never spawn a camera fall back to a clear-only pass.
  - The view bind group is exposed via `ctx.camera.viewBindGroup` but the engine does **not** pre-bind it on the pass. Render systems that want view data set it themselves; Phase 7 (Materials) will pin the `group(0) = view` convention when it has a concrete consumer.

- 12eb41d: feat(engine): Phase 10.5 — cascaded shadow maps for directional lights

  Per ADR-0046, extends ADR-0045's directional/spot shadow maps with **cascaded shadow maps** for directional lights. The camera's view frustum is split into depth slices ("cascades"); each is fit with its own camera-tracking light-space projection and rendered into its own atlas layer, and `pbr.wgsl` selects the cascade per fragment by view-space depth. This removes ADR-0045's fixed origin-centered shadow box: directional shadows now follow the camera and stay crisp from up close out to the shadow draw distance. Spot lights, point lights, and the unlit path are unaffected. No new HAL, no GPU capability flag.

  Directional lights gain cascades automatically — a `CascadeShadowConfig` is auto-inserted on every `DirectionalLight3d`. When no perspective camera drives the scene, directionals fall back to ADR-0045's fixed orthographic box.

  **New public surface:**

  - `CascadeShadowConfig` — per-light component (auto-inserted on `DirectionalLight3d`) configuring its cascaded shadow: `numCascades` (clamped to `[1, MAX_CASCADES]`), `minimumDistance` / `maximumDistance` (the cascaded shadow range in view-space distance), `firstCascadeFarBound`, `overlapProportion` (cascade blend band), `lambda` (uniform↔logarithmic split blend). `CascadeShadowConfigOptions` is the constructor input shape.
  - `MAX_CASCADES` (4) — maximum cascades per directional light (one `vec4` of split distances).
  - `computeCascadeSplits`, `cascadeLightViewProj`, `reserveCasterLayers` (+ `CascadeFitParams`) — pure cascade split + stabilized light-space-fit + layer-reservation helpers (exposed for tests / benches / custom plugins).
  - `packCascadeSplits`, `packDirectionalCascadeBase` — pure packers for the new `GpuLights` cascade metadata.

  **Behaviour changes:**

  - `GpuLights` grew: the uniform buffer is now 8112 B (was 7840), adding a `cascade_splits: vec4<f32>` (per-cascade far view-depths) and growing `shadow_view_proj` from 8 to 12 matrices. `counts.w` (previously unused) now carries the cascade count; a shadowed directional stores its **base** atlas layer in `direction.w` (cascade `c` uses layer `base + c`). `packCounts` gained an optional trailing `cascadeCount` argument. The `@group(2)` layout is unchanged (three bindings) — only the uniform's size.
  - `MAX_SHADOW_CASTERS` grew 8 → 12 so a cascaded sun (up to 4 layers) does not starve spot shadows. The atlas is ~48 MB at defaults (`SHADOW_MAP_SIZE` / `MAX_SHADOW_CASTERS` remain tunable).
  - `DirectionalLight3d.requires` now includes `CascadeShadowConfig`.
  - `Shadow3dSettings` gained `cascadeBackExtension` (depth pulled toward the light per cascade to catch occluders just outside the slice); `directionalExtent` is now the no-perspective-camera fallback box.
  - `Light3dPlugin`'s `light3d-prepare` now reads the active `Core3d` perspective camera (extracted from the main world) to fit cascades. Cascade splits are shared across directionals (a camera function); per-light split ranges, multi-camera fitting, per-cascade caster culling, and per-cascade bias are documented follow-ons.

- 773fabd: feat(engine): `bakeMorphedMesh` — freeze a customized character into a static mesh

  Bakes the character creator's current customization into a fresh, morph-free `Mesh` (ADR-0132):
  compose the weighted sparse targets onto the pristine base positions, copy the base's UVs + indices,
  recompute smooth normals. The result is an ordinary mesh that renders with zero runtime morph cost
  and is ready to rig/skin/animate like any other.

  The studio's character-creator panel gains a **Bake** button that spawns the baked character as a
  standalone entity. Disk persistence (`.rmesh`) and GLB export are deferred
  (`docs/backlog/baked-character-persistence.md`) — no GLB exporter exists yet.

  Verified live: with morph weights set, Bake produces a new 19,158-vertex mesh whose vertices carry the
  composed shape (distinct from the neutral base), and it renders with the renderer healthy. Completes
  RetroHuman Phase 3 (character creator + bake).

- afc904c: feat(engine): character base mesh (vertex-order OBJ) + CPU morph composition

  The two foundations the RetroHuman character creator builds on (ADR-0131):

  - `parseObjBaseMesh` — a **vertex-order-preserving** OBJ→`Mesh` loader: one mesh vertex per OBJ `v`
    line in file order, so a sparse morph target keyed by `v` index aligns vertex-for-vertex. Quads
    (and n-gons) are fan-triangulated, smooth normals are computed (OBJ carries none), one UV per
    position is emitted. Deliberately not a general OBJ importer — a general one splits positions by
    UV/normal seams and would break morph alignment (the MakeHuman base has 21k UVs over 19k vertices).
  - `composeMorphedPositions` — `out[v] = base[v] + Σ weightᵢ·deltaᵢ[v]`, computed sparsely (cost
    `Σ targetᵢ.count`, not `vertexCount × targetCount`), with `WeightedMorphTarget`. The edit-time
    character-creator composition (drag a slider, recompose, re-upload) — no runtime/GPU morph cost.
    Benched (the slider-drag path; ~36 µs for the 19,158-vertex base with 40 active targets).

  Verified on the real vendored `base.obj` (19,158 vertices, 110,916 triangulated indices). Confirms
  the roadmap's edit-time-bake scope; runtime-live customization remains a Phase 5 future.

- 3b3cf7f: feat(engine, renderer-core, renderer-webgpu): color-managed pipeline — sRGB swapchain + per-image color space (ADR-0049)

  Closes the color-management gap ADR-0048 made visible. The swapchain configures `viewFormats: [<base>-srgb]` and `Surface.getCurrentTextureView()` returns an sRGB-encoding view, so the hardware applies the sRGB OETF on store. `Image` gains a `colorSpace: 'srgb' | 'linear'` field (Bevy-shape) that drives whether `RenderImage`'s GPU texture uploads to the base or `-srgb` variant of the image's format. `fs_agx` re-adds the linearisation step (proper sRGB inverse OETF, not the gamma-2.2 approximation) so AgX round-trips bit-for-bit through the swapchain view's encode.

  The visible diff: scenes that were previously dimmed by ~2.2× under the tonemap path (`?mode=lit&hdr=1&tm=…`) now render at intended brightness. Image-heavy 2D scenes look perceptually identical because the two cancelling errors lift symmetrically. AgX specifically goes from "the special-case operator that looked roughly correct" to "the operator whose curve matches its reference implementation".

  **New public surface:**

  - `TextureFormat` (renderer-core) — adds `'rgba8unorm-srgb'` and `'bgra8unorm-srgb'`.
  - `srgbVariantOf(format: TextureFormat): TextureFormat` (renderer-core) — promotes a base format to its `-srgb` sibling; idempotent; noop for formats with no sRGB sibling.
  - `Image.colorSpace: 'srgb' | 'linear'` — Bevy-shape color-space flag. Defaults `'srgb'` from every factory.
  - `ImageColorSpace` — string-literal union exported alongside `Image`.
  - `ImageFactoryOptions` — shared options bag for `Image.solid` / `Image.checker` (`{ sampler?, label?, colorSpace? }`).

  **Behaviour changes:**

  - `Surface.format` now returns the **view** format (the `-srgb` variant of the canvas's preferred storage format). `Renderer.getPreferredSurfaceFormat()` unchanged — still returns the base storage format. Pipelines that already read `view.mainColorTarget.format` (sprite, material2d, light2d composite, tonemap, PBR) pick up the srgb variant automatically.
  - `Image.solid(rgba, opts?)` and `Image.checker(size, a, b, opts?)` move from positional `(rgba, sampler?, label?)` / `(size, a, b, sampler?, label?)` to an options-bag form. Old positional sites need mechanical updates: `Image.solid(rgba, undefined, 'L')` → `Image.solid(rgba, { label: 'L' })`.
  - `Image.fromBytes()` rejects explicit `'rgba8unorm-srgb'` / `'bgra8unorm-srgb'` formats — pass the base format and `colorSpace: 'srgb'` instead. The upload layer applies the variant from `colorSpace`.
  - `Image.WHITE` and `Image.BLACK` seed as `colorSpace: 'srgb'`; `Image.NORMAL_FLAT` seeds as `colorSpace: 'linear'`. `0.0` and `1.0` are bit-invariant under sRGB ↔ linear decode so WHITE / BLACK stay correct as multi-purpose StandardMaterial fallbacks; NORMAL_FLAT must be linear because `0.5` differs (`~0.214` linear if decoded as sRGB).
  - `bytesPerTexel('rgba8unorm-srgb')` / `bytesPerTexel('bgra8unorm-srgb')` both return `4` (same width as the base form).
  - Consumers writing data textures (normal maps, metallic / roughness / AO, displacement, atlas-layout LUTs) must pass `colorSpace: 'linear'` explicitly. Default `'srgb'` is the common case (a color texture); the failure mode for missed data-texture sites is silent sample corruption, not a runtime error.
  - `fs_agx` and `fs_blender_filmic` apply the piecewise inverse sRGB OETF before return — both operators' curves are fused tonemap + display encode, so under an sRGB-encoding swapchain view they need an explicit linearisation step to avoid double-encoding. The other operators (`None`, `Reinhard`, `ReinhardLuminance`, `ACES`, `SBDT`) output linear already — no shader change, but their visible brightness lifts because the swapchain view now applies the sRGB encode they were silently missing. All playground showcases re-tuned visually under the new pipeline.

- 2c27d90: feat(engine): controller-owned animation layers + animation assets to YAML

  Per ADR-0141 and ADR-0142. An `AnimationController` now authors its own layer stack,
  and the three animation asset formats move to YAML to match scenes/prefabs (ADR-0089).

  **New public surface:**

  - `ControllerLayer` — an authored layer on the controller (`name`, `weight`,
    `blend: 'override' | 'additive'`, optional `mask`, and a clip-or-controller
    `source`), structurally an `AnimationLayer` plus a display name.
  - `AnimationController.layers: ControllerLayer[]` — layers composited over the base
    machine (the controller's own `parameters`/`states`/`transitions` are layer 0, full
    body at weight 1). Empty for a single-layer controller.

  **Behaviour changes:**

  - A controller player whose controller declares `layers` composes as a layer stack
    (base machine as layer 0, authored layers above), driven through the shared layered
    path (`driveStack`) with per-layer masks and override/additive blending. A controller
    with no layers keeps its existing single-machine path. `AnimationLayers` is unchanged
    and remains the runtime evaluation primitive + the per-entity composition surface.
  - `.ranimctrl` bumps to wire-format version 3 (adds `layers`) and encodes as YAML.
    Consistent with the ADR-0140 v2 bump this is a clean break — a v2 payload fails the
    version guard with a clear error. `createAnimationControllerImporter` /
    `createAnimationControllerSerializer` now take the controller and mask stores (to
    resolve layer references by GUID) alongside the clip store.
  - `.ranim` and `.ramask` encode as YAML (no version change). YAML is a JSON superset,
    so existing JSON-encoded clips/masks still load and are re-emitted as YAML on save.

- a9837c6: feat(engine): add `createAsset` helper for minting new project assets

  `createAsset(value, kind, serializer, sink, opts)` mints a fresh GUID, serializes the value through its kind serializer, and writes both the asset file and its `.meta` sidecar through the sink — the create-from-scratch complement to `promoteAsset` (which freezes an existing handle's identity). Returns `{ guid, location, bytes }`; rebuilding the manifest and filling the live store slot remain the caller's responsibility, since those depend on the live `AssetServer`. First consumer is the studio character creator, which uses it to persist a textured skin material as a reloadable `.remat` for spawned and baked RetroHuman characters.

- f8079c6: feat(engine): expose `composeTransformInto` / `decomposeTransformInto`

  `composeTransformInto` (previously engine-private) is now public, and a new `decomposeTransformInto` inverts it — splitting a column-major affine 4×4 matrix into translation, rotation, and per-axis scale. Pure translation/rotation/uniform-scale matrices round-trip exactly; a mirrored basis (negative determinant) negates the X scale so the recovered rotation stays proper. Useful for converting between an entity's local `Transform` and its world `GlobalTransform`, e.g. world-space editor tooling.

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

- 294c161: feat(engine): asset count in diagnostics

  `DiagnosticsStore` gains an `assetCount` — the total loaded assets across every
  registered `AssetStores` store, refreshed each frame by `DiagnosticsPlugin`
  alongside FPS / frame-time / entity count. Distinct stores are counted once even
  when bound under several asset-type keys (new `AssetStores.totalAssetCount()`).
  `updateDiagnostics` takes an optional `assetCount` argument (omitting it leaves
  the field untouched), so existing callers are unaffected.

  The remaining piece of the diagnostics item is the on-screen overlay.

- 597b913: feat(engine): windowed frame-time stats + 1%-low FPS in diagnostics

  `DiagnosticsStore` now tracks a rolling window of recent frame times and exposes
  `minFrameTimeMs` / `maxFrameTimeMs` / `avgFrameTimeMs` and `onePercentLowFps` —
  the standard "1% low" stutter metric (`1000 / p99` frame time) — alongside the
  existing smoothed FPS. Backed by a new `FrameTimeWindow` (O(1) ring buffer,
  default 120 frames ≈ 2s) + a pure `frameTimeStats(samples)`.

  `@retro-engine/ui`'s diagnostics overlay `formatDiagnostics` appends the readout
  once the window has samples, e.g. `FPS 60 (low 42)  16.7ms  ents 42  assets 12`.
  Unit-tested + benched (the per-frame window sort).

- 6e1d04c: feat(engine): diagnostics store — FPS / frame-time / entity-count

  Adds the P1 diagnostics store: a live source for an FPS / frame-time overlay or a
  headless perf probe.

  - `@retro-engine/ecs`: `World.entityCount` — the live entity count in O(1) (from
    the internal entity index), so a per-frame reader needn't materialize
    `entities()`.
  - `@retro-engine/engine`: `DiagnosticsStore` resource (`frameTimeMs` EMA-smoothed,
    derived `fps`, `entityCount`, `frameCount`), the pure `updateDiagnostics(store,
realDeltaSeconds, entityCount)` fold, and an opt-in `DiagnosticsPlugin` that
    inserts the store and updates it each frame from the **real** clock delta
    (wall-clock cost, not paused/scaled gameplay time) in a `'last'`-stage system.

  Opt-in and inert until added. Unit-tested (smoothing convergence, first-sample
  seed, zero-delta handling) + an integration test driving `advanceFrame` (frame
  count, live entity count, non-zero fps).

- 2f22822: feat(ecs,engine): ECS change detection — Changed<T> / Added<T> / RemovedComponents<T>

  Surface the per-component mutation ticks already wired into archetype storage so systems can observe what changed since they last ran. First slice of M3 ECS reactivity; sealed in ADR-0012.

  **ECS (`@retro-engine/ecs`):**

  - `World.changeTick` — public read-only getter exposing the monotonic mutation counter. Advances on every `spawn`, `insertBundle`, `removeComponent`, `despawn`, and `markChanged`.
  - `World.markChanged(entity, type)` — explicit mark-dirty for in-place mutation of reference-typed component data. Bumps the tick and writes the new value into the component's `changedTick` column. Silent no-op on unknown entity or absent component.
  - `QueryFilters` gains `changed?: ComponentType[]` and `added?: ComponentType[]`. Both gate row inclusion against a per-system `sinceTick` threshold; neither alters row shape (unlike `has`).
  - `World.query(types, filters, sinceTick?)` — new optional third arg threads through to the filter check. Defaults to `0` ("observe everything") so existing callers behave identically.
  - Storage carries two parallel tick columns per component — `changedTickColumns` (mutation) and `addedTickColumns` (attach). `Added<T>` implies `Changed<T>` by construction.
  - Per-component removal buffer on `World` populated by `removeComponent` and `despawn`. Read via internal `getRemovedComponents(type)`; drained at frame boundary by `drainRemovedBuffer()`.
  - `RemovedEntry` type re-exported from the package root.

  **Engine (`@retro-engine/engine`):**

  - `RemovedComponents(ctor)` — new system param yielding `Iterable<Entity>` over entities whose component was removed since the calling system's last run. Frame-boundary drain (v1 limitation: `runIf`-gated systems lose removals from frames they did not run in).
  - `ResolveCtx` gains a required `lastSeenTick: number`. The scheduler captures `World.changeTick` pre-system (Bevy-aligned pre-run snapshot) and writes it to a per-system `lastSeenTickMap` on `App` after the system runs. Consequence: a system re-observes its own prior-frame mutations on its next invocation.
  - `Query(types, filters)` param threads `ctx.lastSeenTick` through to `World.query` automatically. Filter cache key extended to include `changed` / `added` content.
  - All system-running paths (`runStage` for Main/FixedMain, `invokeStateSystem` for state transitions, `App.renderFrame` for render) participate in the same snapshot model.
  - `App.advanceFrame` drains the removed-components buffer at end of frame, after every stage.

  **Out of scope (deferred):**

  - Finer-grained resource change detection. `App.resourceChangeFrames` and the `resourceChanged` run-condition are unchanged; no `Res<T>.isChanged()` / `ChangedRes(T)`. Promotes from backlog when a real consumer pulls.
  - Gating `propagateTransforms` on `Changed<Transform>`. The surface is shipped here; the optimization gets its own slice.

- 62e382e: feat(ecs,engine): observers + Message<T> + component lifecycle hooks (M3 phase 2)

  Push-based half of the ECS reactivity layer, on top of the change-detection primitive shipped in ADR-0012. Sealed in ADR-0013. Adopts Bevy 0.17 vocabulary (`Message` / `Event` split, `.write` writer name) on day 1 so consumers do not face a later rename.

  **ECS (`@retro-engine/ecs`):**

  - `World.advanceTick(): number` — public additive method bumping the mutation counter without touching any tick column or removed buffer. Used by `MessageWriter.write` to stamp messages with a strictly-increasing tick, eliminating the missed-message edge case when a system writes messages but does no structural mutations.
  - `World.componentTypesOf(entity)` (`@internal`) — enumerate the component classes currently attached to an entity. Used by the engine commands flush for the per-component `onRemove` fan-out at despawn.

  **Engine (`@retro-engine/engine`):**

  - **Message channels.** `MessageWriter(ctor)` / `MessageReader(ctor)` system params. `app.addMessage(ctor)` registers a type. Writers stamp each `.write(msg)` with a fresh world tick; readers filter by `lastSeenTick`, mirroring `RemovedComponents`. Per-type buffers drain at end of `advanceFrame`, after `world.drainRemovedBuffer()`.
  - **Observers + triggers.** `commands.trigger(event)` enqueues a global trigger; `commands.entity(e).trigger(event)` enqueues an entity-targeted one. `app.addObserver(eventCtor, params, fn)` registers a global observer; `commands.entity(e).observe(eventCtor, params, fn)` registers an entity-targeted one (deterministically at flush). `Trigger(eventCtor)` param exposes `trigger.event()` and `trigger.entity()`. Targeted observers fire before globals; observers run in registration order. Triggers fire at the commands flush, not at the call site.
  - **Re-entrant triggers.** An observer body that calls `commands.trigger(...)` chains into the same flush. Depth limit 8; the 9th nested trigger emits a `devWarn` and is dropped.
  - **Component lifecycle hooks.** `onAdd` / `onInsert` / `onReplace` / `onRemove`, declared as static methods on the component class (`class Sprite { static onAdd(ctx) {…} }`) or registered via `app.registerComponentHook(ctor, kind, fn)`. Hooks fire during the commands flush — pre-mutation for `onReplace` / `onRemove`, post-mutation for `onAdd` / `onInsert`. Static methods fire before registry entries; registry entries fire in registration order. Hook ctx exposes `world`, `commands` (bound to the triggering system's buffer), `entity`, and `value`.
  - **Despawn cleans up entity-targeted observers.** No leak across entity reuse.
  - **`flushSystemCommands` reworked** to process the buffer with a while-loop pattern so ops enqueued by hooks / observers during dispatch fire in the same flush. Try-finally cleanup ensures throw-safety: the buffer entry is removed even when an applyCommandOp arm throws mid-flush.

  **Out of scope (deferred):**

  - Lifecycle-as-trigger sugar (Bevy's `Event<OnAdd<T>>` / `Event<OnRemove<T>>`). The ordering rule "observers before hooks" is locked in ADR-0013 so a follow-up slice can land the sugar without re-opening this ADR.
  - Migrating recursive despawn (`commands.entity(e).despawnRecursive`) from its manual `Children` walk to an `onRemove(Parent)` hook. Surface shipped here; migration is the natural first consumer in the follow-up slice.
  - A constrained `DeferredWorld` wrapper class. v1 hooks receive the full `World` reference + a `CommandsHandle`; recoverable when a footgun manifests in practice.
  - Direct `world.spawn` / `world.insertBundle` / `world.removeComponent` / `world.despawn` calls (outside a commands flush) do NOT fire hooks or observers in v1. Test code that needs hook coverage routes through `Commands`.

- 5d7a21a: feat(editor): general drag-and-drop pattern + Prefab asset kind

  Per ADR-0136, adds one reusable drag-and-drop primitive to the EditorSDK and the
  engine/editor support that lets the studio wire it to prefabs, asset fields, the
  hierarchy, and the scene view.

  **`@retro-engine/editor-sdk`:**

  - `ui.dragSource(payload, options?)` / `ui.dropTarget({ accepts, onDrop, highlight? })` — mark the last-submitted item as a drag source or drop target. Built on ImGui's native drag-drop with a JS-side channel (`dragContext`) for the rich payload, so targets draw their own accept (green) / reject (red) highlight from the `accepts` predicate and deliver on release. The payload union is open for custom drag kinds.
  - New exports: `DragPayload`, `EntityDragPayload`, `AssetDragPayload`, `DragContext`, `dragContext`, `DND_TYPE`, `DragSourceOptions`, `DropTargetOptions`, `ItemDnd`, `applyItemDnd`.
  - `treeItem` gained `accent`, `suffix`, `overridden`, and `recessed` options so a row can render an instance/model tone, a faint source filename, an "edited from source" dot, and a recessed (inherited) style. `RetroPalette` gained `prefab` / `scene` / `model` accent tones.

  **`@retro-engine/engine`:**

  - `serializePrefab(app, root, opts?)` — serialize a single entity subtree into `SceneData` for a reusable prefab: walks `Children` from `root`, drops the root's `Parent` edge, and omits App resources (a prefab is an object, not a world).
  - A distinct **Prefab** asset kind (`PREFAB_ASSET_KIND` = `'Prefab'`, `PREFAB_ASSET_EXTENSION` = `'prefab'`) registered by `ScenePlugin` against the existing `Scenes` store via `registerLoaderByKind`. A prefab loads and mounts through the same `SceneRoot` path as a scene (linked instance), distinguished only by its kind — so scene-only and prefab-only behaviour can diverge later with no asset migration.
  - `hasCompositionOverrides(app, mount)` — whether a `SceneRoot`/instance entity currently differs from the source it was instantiated from (the same diff `serializeScene` records as overrides), surfaced for editor affordances.

  **`@retro-engine/editor-mcp`:**

  - New commands `prefab.createFromEntity`, `asset.instantiate` (kind-generic: scene/prefab → `SceneRoot`, glTF → `GltfSceneRoot`, mesh → `Mesh3d` + default material), and `material.apply` — all undoable through editor `History` and recorded in the audit ring. `asset.instantiate`'s undo despawns the whole instantiated subtree (root + reactor-spawned children), not just the root. `prefab.createFromEntity` names the file after the source entity (deduped with ` (1)`, ` (2)`, …) instead of the GUID.
  - `CommandContext.reindexAssets` — optional studio-provided rescan so a just-written asset is discoverable.
  - `StudioBridge.run(name, args)` — invoke a command locally (e.g. from a UI drop) on the same history/audit path as a remote MCP invoke.

- 8d36fd7: feat(engine): XY work-plane option for the editor grid

  Per ADR-0077, the editor grid (ADR-0076) can now be drawn on the XY work plane as well as the XZ ground plane, so an orthographic 2D editor view has a grid that faces the camera. `EditorGrid.plane` selects which plane; the same Core3d pass renders either.

  The grid shader is generalized rather than duplicated: it emits a world-space quad on the selected plane transformed by `view_proj` (so depth stays correct and meshes occlude the grid in both modes), reusing the existing fwidth-AA line computation. For an orthographic camera it sizes the quad to the visible extent (`1 / projection[i][i]`) and skips the distance fade; for a perspective camera it keeps the camera-distance fade. The config uniform gains a single `plane` flag — no second shader, pass, or pipeline.

  **New public surface:**

  - `EditorGrid.plane: GridPlane` (`'xz' | 'xy'`, default `'xz'`) — selects the ground plane vs. the XY work plane.
  - `GridPlane` — `'xz' | 'xy'` string-literal union.

  No behaviour change for existing users: `plane` defaults to `'xz'` and the grid renders exactly as before.

- 3b04954: feat(engine): editor ground-plane grid (`GridPlugin`, `EditorGrid`)

  Per ADR-0076, adds an analytic ground-plane reference grid rendered by a dedicated, opt-in pass that mirrors the gizmo pass and reuses its editor-only render layer (`EDITOR_GIZMO_LAYER`), so the grid shows in editor viewports and never in the Game view.

  The grid lines are computed per-fragment from world coordinates and anti-aliased against the screen-space derivative (`fwidth`), with a smooth radial distance fade — so it stays crisp and dissolves cleanly toward the horizon at steep / grazing angles, where a line-based grid would shimmer and moiré. Geometry is a single camera-centered quad on the plane, transformed by `view_proj`, so depth comes from rasterization and scene geometry occludes it correctly (depth-tested, never depth-writing) with no inverse-matrix or `frag_depth` work. No new HAL, no new capability flag — `fwidth` is GLSL ES 3.0, so the grid is WebGL2-reachable.

  **New public surface:**

  - `EditorGrid` — config resource (live-mutable): `enabled`, `planeHeight`, `cellSize`, `majorEvery`, `minorColor` / `majorColor` / `xAxisColor` / `zAxisColor`, `fadeStart`, `fadeEnd`, and `snapEnabled` / `snapStep` (carried for snap tooling; the renderer ignores them).
  - `GridPlugin` — opt-in plugin (not auto-installed by `CorePlugin`); registers the `retro_engine::grid` shader, inserts the config + GPU resources and the per-frame uniform upload, and wires the pass into Core3d after the transparent + post passes and before the gizmo pass.
  - `GridRenderState` (`GridPipelineKey`) — render-world GPU state: config uniform buffer, `@group(1)` bind group, format-specialized pipelines.
  - `GridPass3dLabel` — render-graph label for the grid pass node.

  The config uniform is view-independent (per-camera data comes from the shared view bind group), so one buffer uploaded once per frame serves every editor camera. Cost is a single fixed 6-vertex draw per editor camera; nothing scales with scene content.

- 1280e03: feat(engine): add `Commands` system param with per-system flush

  `Commands` is a system param that records structural mutations
  (`spawn` / `despawn` / `entity().insert` / `entity().remove` /
  `insertResource` / `removeResource`) into a per-system buffer and applies
  them at deterministic boundaries — immediately after each system's
  function returns. `cmd.spawn` returns an `Entity` synchronously so
  sibling commands in the same buffer can target it. `App.flushCommands()`
  is the orchestration-side escape hatch.

  Adds `World.reserveEntity()`, `World.spawnReserved()`, and
  `World.hasEntity()` as low-level building blocks. Sealed in ADR-0009.

- fdde82f: feat(engine): reflection schemas for every authored component — ADR-0064

  ADR-0061 registered the core graph plus one renderable family; every other component was an unregistered, tracked gap (CLAUDE.md §13). This closes the whole component gap — each authored component now declares its serialization in its owning plugin, and each derived/transient one is a named not-serialized category.

  Newly registered: cameras (`Camera`, `PerspectiveProjection`, `OrthographicProjection`, `RenderLayers`), 3D lights (`DirectionalLight3d`, `PointLight3d`, `SpotLight3d`, `CascadeShadowConfig`, `NotShadowCaster`), 2D lights (`PointLight2d`, `SpotLight2d`, `DirectionalLight2d`, `AmbientLight2d`, `LightOccluder2d`), the 2D stack (`Sprite` with its 9-slice + atlas config, `TextureAtlas`, `AtlasAnimation`, `Mesh2d`, per-type `MeshMaterial2d<M>`), and per-camera post-process config (`ScreenSpaceAo`, `Tonemapping`, `MotionBlur`, `Taa`, the prepass markers).

  A scene with a camera, lights, sprites, and 2D meshes now round-trips `serialize → JSON → spawnScene` with field values, hierarchy, recomputed `GlobalTransform`, and GUID-resolved handles intact. Union-typed fields (clear color, ortho scaling mode, sprite anchor / 9-slice) ride on the new reflect `t.variant` kind. Resources (e.g. `AmbientLight`, `ClearColor`, `Light2dSettings`) stay deferred — they await a resource-reflection mechanism.

- 9d41f83: feat(engine): window cursor control (visibility + pointer lock)

  `WindowPlugin` gains the **write** side of windowing via a new `WindowBackend`
  HAL (headless-safe, mirroring `InputBackend`/`AudioBackend`; ADR-0170). A
  `CursorOptions` resource (`visible`, `grab: 'none' | 'locked'`) is the game-facing
  API — set `grab: 'locked'` (from a click) for FPS/free-look mouselook, then read
  `MouseMotion` deltas:

  ```ts
  app.addPlugin(new WindowPlugin({ cursorTarget: canvas }));
  app.addSystem(
    "update",
    [Res(MouseButtonInput), ResMut(CursorOptions)],
    (m, c) => {
      if (m.justPressed("Left")) c.grab = "locked";
    }
  );
  ```

  `DomWindowBackend` toggles the element's CSS cursor + drives the Pointer Lock
  API; a `HeadlessWindowBackend` no-ops (and is the default until a `cursorTarget`
  is supplied). Pure `reconcileCursor` applies to the backend only on change,
  unit-tested with a mock backend. `CursorOptions` is runtime state (not
  serialized). Pointer lock is browser-gesture-gated by design.

- 056bfc9: feat(engine): serve a built-in default font so text works with no asset

  `TextPlugin` now auto-installs the engine's procedurally-generated SDF font (when
  `Images` is present, i.e. alongside `ImagePlugin`/`CorePlugin`) and exposes it as
  a new `DefaultFont` resource. `UiText` / `Text` with no explicit font fall back to
  it, so text renders out of the box without dropping a `.font` asset on disk.

  - New `DefaultFont` resource holding the built-in font handle.
  - `installDefaultFont(app)` is now idempotent — it returns the existing default
    font if one is already installed (so an explicit call reuses the auto-installed
    one) and records it in `DefaultFont`.

- 1cdff13: feat(engine): lifecycle-as-trigger sugar — `Lifecycle.onAdd/onInsert/onReplace/onRemove(Comp)` (ADR-0015)

  Component mutations are now observable through the same `Trigger<E>` / observer surface that gameplay events already use. Four factory entrypoints under a new `Lifecycle` namespace:

  ```ts
  class Sprite {
    constructor(public src: string) {}
  }

  // Global observer for every Sprite that lands on an entity.
  app.addObserver(
    Lifecycle.onAdd(Sprite),
    [Trigger(Lifecycle.onAdd(Sprite))],
    (t) => console.log(`sprite ${t.event().value.src} on entity ${t.entity()}`)
  );

  // Entity-targeted observer — fires only for the bound entity, dropped on despawn.
  cmd
    .spawn(new Sprite("hero.png"))
    .observe(
      Lifecycle.onRemove(Sprite),
      [Trigger(Lifecycle.onRemove(Sprite))],
      (t) => {
        saveSpriteSlot(t.event().value);
      }
    );
  ```

  Each `Lifecycle.onX(Comp)` call returns a stable, cached synthetic class per `(kind, componentCtor)` pair — `Lifecycle.onAdd(Sprite) === Lifecycle.onAdd(Sprite)`. The class is directly usable as the event-key for `app.addObserver`, `commands.entity(e).observe`, and `Trigger(...)`.

  **Observer-before-hook ordering (ADR-0013 §11).** For any `(kind, type)` that has both an observer and a component hook registered, the observer fires first. Lets consumers inspect lifecycle moments before the engine's own hooks run — most notably, a `Lifecycle.onRemove(Children)` observer fires before `CorePlugin`'s cascade hook tears the subtree down (ADR-0014).

  **Event payload shape:** `LifecycleEvent<T>` carries `{ entity, value }`, mirroring `HookCtx<T>`. `value` semantics match the hook of the same kind — just-installed for `onAdd` / `onInsert`, OLD value for `onReplace`, about-to-be-removed for `onRemove`.

  **Depth handling:** lifecycle dispatch is inline — it does not consume `MAX_TRIGGER_DEPTH` slots. A lifecycle observer can call `cmd.spawn(...)` to chain into more lifecycle dispatches; the chain self-terminates the same way ADR-0014's cascade does. `cmd.trigger(...)` calls inside a lifecycle observer still increment depth and remain subject to the cap.

  **API surface (additive, no breakage):**

  - `Lifecycle` (value) and `LifecycleEvent<T>` (type) — new exports from `@retro-engine/engine`.
  - Internal: `apply*WithHooks` helpers swap `CommandsHandle` for `SystemId` in their signatures (engine-private, not on the consumer surface).

  **ADR provenance:**

  - Seals ADR-0015.
  - Consumes ADR-0013 §11 (observer-before-hook ordering) and §15 (hook payload semantics) as a pure consumer — ADR-0013's body stays frozen per CLAUDE.md §3.
  - Composes with ADR-0014's cascade: the cascade moment is now observable without modifying `CorePlugin`.

- 1c76eef: feat(engine): Name value component

  Adds `Name`, a standalone value component (`{ value: string }`) for attaching a human-readable name to an entity. No required companions and no engine-core reader — it exists to be queried by consumer code that identifies or looks entities up by name.

- d8b7fc2: feat(engine): Plugin lifecycle + plugin groups (M2 phase 8)

  Closes M2 by upgrading the `Plugin` surface from `(app: App) => void` to a Bevy-shaped lifecycle:

  - `PluginObject` — canonical interface with `name()`, optional `isUnique()`, `build(app)`, optional `ready(app)`, `finish(app)`, `cleanup(app)`. The new shape for class plugins.
  - `Plugin` is now a public union `PluginObject | PluginFn` so the M1 `trianglePlugin` (annotated `: Plugin = (app) => {...}`) and the inline studio function plugin compile unchanged.
  - `App` carries a plugin state machine — `Building` → `Ready` → `Cleaned`. The first call to `advanceFrame` (or `run`) ticks the lifecycle: polls every plugin's `ready()`, then runs `finish()` and `cleanup()` in registration order. Synchronous plugins traverse all three states on the first frame. `addPlugin` after the machine leaves `Building` throws.
  - Function-callback plugins are auto-wrapped at `addPlugin`: named functions become unique by `fn.name`, anonymous lambdas are non-unique. Uniqueness for class plugins is keyed on `name()` (default `this.constructor.name`-style).
  - `PluginGroupBuilder` with `.add`, `.disable<T>(ctor)`, `.set<T>(ctor, replacement)`, `.build(): PluginObject[]`. `PluginGroup` interface for shippable bundles. `app.addPlugins(input)` accepts `PluginObject[]`, a `PluginGroup`, or a `PluginGroupBuilder` directly.
  - `CorePlugin` — built-in plugin registered first by the `App` constructor. Inserts the `Time` resource, registers `Time.tick` in `'first'`, and registers `propagateTransforms` in `'postUpdate'`. Replaces the prior inline constructor wiring; observable behavior is unchanged (Time is still live immediately after `new App({...})`).

  Single-threaded throughout. Sealed in ADR-0011.

- 5ea3e80: Add the `Query(types, filters?)` system param. Mirrors the `Res` / `ResMut` shape: each token is cached per `(types-order, filter-shape)` so `Query([A, B]) === Query([A, B])`, letting a future schedule planner dedup read/write sets by token identity. `with` and `without` are normalized as set-semantic; `has` preserves declaration order because it changes the yielded row shape.

  ```ts
  class Position {
    constructor(public x = 0, public y = 0) {}
  }
  class Velocity {
    constructor(public vx = 0, public vy = 0) {}
  }
  app.addSystem("update", [Query([Position, Velocity])], (q) => {
    for (const [pos, vel] of q) pos.x += vel.vx;
  });
  ```

- 68963c6: feat(engine): resource change detection + Changed<Transform>-gated propagation (ADR-0016)

  Closes the two deferrals ADR-0012 left open: writer- **and** reader-side resource change detection, plus a `propagateTransforms` that only touches subtrees whose `Transform` or `Parent` actually moved this frame.

  ### Writer-side: `markResourceChanged`

  Symmetric to `world.markChanged(entity, type)` for components. Stamps the resource's change-frame so `resourceChanged` and the new `ChangedRes` observe the mutation. `devWarn` no-op when the resource is not registered.

  ```ts
  class Counter {
    value = 0;
  }
  app.insertResource(new Counter());

  // Outside a system (tests, plugin lifecycle):
  app.markResourceChanged(Counter);

  // Inside a system body — deferred via the commands buffer:
  app.addSystem("update", [Commands, ResMut(Counter)], (cmd, c) => {
    c.value += 1;
    cmd.markResourceChanged(Counter);
  });
  ```

  ### Reader-side: `ChangedRes` and `ResAdded` params

  Parallel-param shape — declared alongside `Res(T)` / `ResMut(T)`, non-breaking. `ChangedRes(T)` resolves to `true` iff the resource's change-frame has moved since the calling system last ran; `ResAdded(T)` resolves to `true` iff the resource was inserted fresh in the same window. Mirrors `RemovedComponents(T)` as a parallel reactivity primitive rather than a wrapper on the resolved value.

  ```ts
  app.addSystem(
    "update",
    [ResMut(Counter), ChangedRes(Counter)],
    (counter, didChange) => {
      if (didChange) recomputeExpensiveDerivedState(counter);
      counter.value += 1;
    }
  );

  app.addSystem("startup", [ResAdded(AudioMixer)], (justAdded) => {
    if (justAdded) primeMixerVoices();
  });
  ```

  Cross-frame accumulation works automatically for `runIf`-gated systems — `lastSeenFrame` only advances when the system actually runs, so a mark made during a skipped frame is still visible on the next actual run. The wrapper-style `Res<T>.isChanged()` alternative was considered and rejected; it would have broken every existing `Res` / `ResMut` call site.

  ### Gated transform propagation

  `propagateTransforms` no longer recomputes every `GlobalTransform` from scratch each frame. The new gated pass touches only entities whose `Transform` or `Parent` changed this frame, expanded via BFS over `Children` so a parent's mutation reaches every descendant (the parent-child invariant ADR-0012 §8 flagged). Empty dirty set → early return; no row scan, no depth sort. On the first frame after spawn, every freshly-spawned entity's `Transform.changedTick` is current, so the dirty set covers the full world — same cost as before from frame 1.

  Every entity whose `GlobalTransform` is recomputed is reported via `world.markChanged(entity, GlobalTransform)` so downstream consumers can filter:

  ```ts
  // Canonical use: GPU upload pump for dirty world matrices only.
  app.addSystem(
    "render",
    [Query([GlobalTransform], { changed: [GlobalTransform] })],
    (dirty) => {
      for (const [_entity, global] of dirty.entries())
        uploadWorldMatrix(global.matrix);
    }
  );
  ```

  **Direct field writes still need `markChanged`.** Mutating `transform.translation[0] = 5` does not auto-bump `Transform.changedTick`; gated propagation will not pick it up. Follow up with `world.markChanged(entity, Transform)` — same explicit-mark rule that has always applied to `Changed<T>` consumers. The unconditional `propagateTransforms(world, logger)` free function is preserved for ad-hoc full recomputation.

  ### Correctness fix: in-place reparenting now bumps `Parent.changedTick`

  `Commands.appendChild`'s in-place mutation branch (when the child already has a `Parent`) previously assigned `existingParent.entity = newParent` without bumping the tick. Any consumer using `Changed<Parent>` from ADR-0012 phase 1 missed reparenting via `addChild`. Fixed.

  ### API surface (additive, no breakage)

  - `App.markResourceChanged(ctor)` — synchronous writer-side hint.
  - `CommandsHandle.markResourceChanged(type)` — deferred writer-side hint.
  - `ChangedRes(ctor)` — reader-side `Param<boolean>`.
  - `ResAdded(ctor)` — reader-side `Param<boolean>`, parallel to component `Added<T>`.
  - `ResolveCtx.lastSeenFrame: number` — added next to `lastSeenTick` (visible to anyone hand-constructing a `ResolveCtx` for custom dispatch).
  - Internal: `App.lastSeenFrameMap`, `App.lastSeenFrameOf`, `App.recordSystemLastSeenFrame`, `App.getResourceAddedFrame`, `App.currentFrameNumber` promoted to `@internal` public.

  ### ADR provenance

  - Seals ADR-0016.
  - Consumes ADR-0012 §7 (resource change detection) and §8 (`propagateTransforms` gating) — ADR-0012's body stays frozen per CLAUDE.md §3.
  - Independent correctness improvement: `Commands.appendChild` in-place reparenting now interoperates with the `Changed<Parent>` surface introduced by ADR-0012 phase 1.

- be766a4: Engine logger + resource registry phase 2.

  - **Engine logger** (per ADR-0007). New `Logger` interface (`error` / `warn` / `info` / `debug` / `devWarn` / `child(category)`), default `ConsoleLogger` impl exported as `createConsoleLogger()` and the shared `engineLogger`. `App` now owns `logger: Logger` (field) and accepts `AppOptions.logger` to override the default. Consumers (studio, Tauri panels, telemetry sinks, tests) replace the engine's diagnostic sink at App construction with no engine-side code changes. `devWarn` is the dev-only advisory channel — silent when `NODE_ENV === 'production'`, emits otherwise. The other four severities always emit. Leaf packages (`renderer-*`, `ecs`, `math`) intentionally do not depend on the logger; they surface failures by throwing self-contained, package-prefixed `Error`s and the engine logs at the boundary.
  - **Resource registry phase 2.** New `App.removeResource(ctor): T | undefined` (Bevy-aligned return, idempotent). New `ResMut(ctor)` factory — the symmetric write twin of `Res(ctor)`, separate cache so `Res(Foo) !== ResMut(Foo)` and a future schedule graph can distinguish read vs. write intent. `Res<T>` now resolves to `DeepReadonly<T>` at the type level, so shallow and nested mutations through a `Res<T>` reference are compile errors; `ResMut<T>` keeps the live, writable type. Runtime behaviour is identical between the two — both return the same registered instance. `App.insertResource` now emits a `devWarn` through the App logger when replacing an existing resource of the same constructor key (silent in production). The missing-resource error is more actionable: `Res(Foo): resource not registered — did you forget app.insertResource(new Foo())?` (analogous wording for `ResMut`).
  - `@retro-engine/engine` re-exports `Logger`, `engineLogger`, `createConsoleLogger`, and `ResMut`.

  Migration: existing `Res(T)` call sites that _only_ read a resource keep working unchanged. Call sites that _write_ through `Res(T)` must switch to `ResMut(T)` — the runtime behaviour is identical, but `Res<T>` is now read-only at the type level.

- bc7640e: Engine schedule rewrite + States subsystem + run-condition helpers + ordering + fixed timestep + state-scoped resources (M2 phase 5).

  - **Main schedule rewrite.** `Stage` widens to include `'last'` (cleanup stage after `postUpdate`) and the five `'fixed*'` sub-stages. Each frame now runs `'first'` → `'startup'` (first frame only) → `'preUpdate'` → _StateTransition_ → _RunFixedMainLoop_ → `'update'` → `'postUpdate'` → `'last'` → `'render'`. StateTransition and RunFixedMainLoop are internal driver phases — users hook them through `onEnter` / `onExit` / `onTransition` / `insertStateScopedResource` / `addSystem('fixedUpdate', ...)`.
  - **Ordering within a stage.** `AddSystemOptions` gains `label?: string`, `before?: readonly string[]`, `after?: readonly string[]`. Topological sort runs eagerly inside `addSystem`; introducing a cycle throws at the registration call site and rolls the offending registration back. Forward references to labels not yet registered are allowed.
  - **States subsystem.** New `App.initState(ctor, initial)` registers a state type plus its initial value. `State(ctor)` and `NextState(ctor)` are factory tokens returning per-state-type minted resource classes (`Res(State(GameState))` / `ResMut(NextState(GameState))`). New methods `App.onEnter(value, params, fn)`, `App.onExit(value, params, fn)`, `App.onTransition(from, to, params, fn)` register transition systems. The engine drives `OnExit(S_old)` → remove state-scoped(S_old) → `State.current = S_new` → `OnTransition(S_old, S_new)` → insert state-scoped(S_new) → `OnEnter(S_new)` once per pending transition. Initial transition skips OnExit / state-scoped removal / OnTransition. `NextState` is last-write-wins per frame; identity transitions fire a full cycle. State values are user-class instances; the state type is recovered via constructor identity, with no `States` base class required.
  - **Run-condition helpers.** New `inState(value)`, `resourceExists(ctor)`, `resourceChanged(ctor)`, `anyWithComponent(ctor)` factories that return `RunCondition` instances composable through the existing `.and()` / `.or()` / `.not()`. `resourceChanged` is v1 frame-stamped — it fires only on the frame the resource was inserted, replaced, or removed; in-place mutations are not detected (full change detection lands in M3 with `Changed<T>`).
  - **Fixed timestep.** `Time.fixed` sub-clock joins `Time.virtual` and `Time.real`. Default `timestep = 1/60` (configurable via `ResMut(Time)`). The accumulator advances each frame from `Time.virtual.delta` (so pausing or scaling virtual pauses or scales the fixed loop). The five `fixed*` stages run sequentially per substep, capped at 8 substeps per frame; if the cap is hit while the accumulator is still ≥ timestep, the residual is dropped and a single warn fires through `app.logger`.
  - **State-scoped resources.** New `App.insertStateScopedResource(value, resource)`. The resource is inserted before `OnEnter(value)` runs and removed **after** user `OnExit(value)` systems complete — so `OnExit` code can read the resource one last time. Resources for the same state value are inserted/removed in registration order; the same constructor can back resources scoped to different state values.
  - **`App.insertResource` / `App.removeResource` now bump a per-resource change-frame stamp** used by `resourceChanged`. New package-internal `App.getResourceChangeFrame(ctor)`.

  Migration: existing systems registered against the surviving stages (`'startup'`, `'first'`, `'preUpdate'`, `'update'`, `'postUpdate'`, `'render'`) keep working unchanged. `'startup'` now runs as the first-frame portion of `advanceFrame` (between `'first'` and `'preUpdate'`) rather than outside `advanceFrame`; this is observable only if you were stepping the loop manually and relying on the exact pre-startup boundary. ADR-0008 records the sealed decisions.

- cad5613: Engine `Time` resource (M2 phase 3) and the `'first'` stage / `advanceFrame` primitive that ride underneath it.

  - **`Time` resource.** New `Time` class (re-exported from `@retro-engine/engine`) with a Bevy-derived virtual / real split. `time.virtual` (`delta`, `elapsed`, `paused`, `scale`) is the pausable, scalable game clock — the default for gameplay. `time.real` (`delta`, `elapsed`) is wall-clock time and is never paused or scaled. `time.frame` is a monotonic counter that increments every frame regardless of pause. Units across the public API are seconds-as-numbers (a 60fps frame yields `delta ≈ 0.0167`). The inter-frame gap is clamped to 100ms so tab-resume / debugger-pause cannot fling `delta` to multi-second values. The first frame after construction emits `delta = 0` for both clocks; subsequent frames yield the actual elapsed time.
  - **Auto-registered on `App` construction.** `new App(...)` registers `Time` (no manual `app.insertResource(new Time())` needed) and an engine-internal `'first'`-stage tick system that drives it. The internal system is the first real consumer of `ResMut<Time>` end-to-end — the read/write split sealed in M2 phase 2 (`Res<T>` = `DeepReadonly<T>`, `ResMut<T>` writable) propagates recursively into the sub-clocks, so `time.virtual.paused = true` is a compile error through `Res<Time>` and an allowed mutation through `ResMut<Time>`.
  - **New `'first'` stage.** `Stage` now includes `'first'`, running before `'preUpdate'`. The engine's `Time` tick lands here; user systems may register on `'first'` to run "before everything" (after the engine's internal systems in registration order).
  - **New `App.advanceFrame(timestampMs?)`.** Public single-tick primitive: runs `'first'` → `'preUpdate'` → `'update'` → `'postUpdate'` → render in order, threading `timestampMs` through to the engine's `Time` tick. `App.run` is rewritten on top of it — under `requestAnimationFrame`, each callback is `t => this.advanceFrame(t)`. Tests step frames synchronously with `app.advanceFrame(16.67); app.advanceFrame(33.33);` rather than mocking rAF; consumers gain a clean "step one frame" handle for replay / time-rewind tooling.
  - `VirtualClock` and `RealClock` are exported as `type` for structural annotation without importing the class.

  Migration: none. The additions are purely additive — existing `App.run` semantics under rAF are unchanged.

- 4741039: feat(engine): window fullscreen toggle

  Extends the `WindowBackend` write-back seam (ADR-0170) with fullscreen. A new
  `WindowMode` resource (`fullscreen: boolean`, runtime — not serialized) is the
  game-facing API; `WindowPlugin` applies changes to the window each frame via the
  backend:

  ```ts
  app.addSystem(
    "update",
    [Res(KeyboardInput), ResMut(WindowMode)],
    (keys, mode) => {
      if (keys.justPressed("F11")) mode.fullscreen = !mode.fullscreen;
    }
  );
  ```

  `WindowBackend.setFullscreen` drives the Fullscreen API in `DomWindowBackend`
  (`requestFullscreen` / `exitFullscreen`) and no-ops in `HeadlessWindowBackend`.
  Pure `reconcileWindowMode` applies only on change, unit-tested with a mock
  backend. Fullscreen entry is browser-gesture-gated (set it from a click / key
  press), same as pointer lock.

- 4ca7beb: feat(engine): event-driven visibility cull + retained prepares — ADR-0040

  ADR-0039 made the retained prepares pack and sort in O(changed), but left two per-frame O(n) base walks a static-but-visible entity still paid every frame: `checkVisibilitySystem` rewrote `ViewVisibility` for every renderable, and each retained prepare walked its whole visible set to detect spawns/despawns/visibility-flips. Both are now event-driven.

  - `checkVisibilitySystem` is change-gated: with an unchanged active-camera set it recomputes only entities whose own inputs changed (`Changed<GlobalTransform | Aabb | InheritedVisibility | RenderLayers>` + removed `Aabb`/`NoFrustumCulling`); any camera move/projection/add/remove (detected by a frustum + layer-mask snapshot compare) forces a full recompute identical to a per-frame walk. It now stamps `Changed<ViewVisibility>` only on a real flip, making visibility edges observable.
  - The retained sprite/mesh prepares maintain their slot set from those change events plus the removed buffer — no per-frame structural walk. A small pending set re-checks entities whose asset hasn't uploaded yet. The mesh prepare applies per-camera add/update/remove deltas and recomputes depth only when a camera's view matrix changed.

  This is the new implementation of the existing `{ retained: true }` plugin option (no new flag); the legacy full-repack path (`{ retained: false }`) stays as the fallback and parity reference. A static scene now does O(changed) cull + prepare work — bench shows the event-driven static frame ~7–9× faster than the legacy walk for meshes and ~2.3× for sprites, with far less per-frame allocation.

- 0bc6ca5: feat(engine): exclusive `world()` systems

  ECS ordering depth Phase 4 (ADR-0160). A `world()` system param resolves to the
  stage's live `World` for immediate structural edits — spawn / despawn / insert /
  remove that take effect mid-system, with same-frame read-back — instead of
  deferring through `Commands`:

  ```ts
  app.addSystem("startup", [world()], (w) => {
    const player = w.spawn(new Transform());
    w.insertBundle(player, [new Health(100)]);
  });
  ```

  A system carrying `world()` must declare no other params (it holds the whole
  world); registration throws otherwise, via a new optional `Param.exclusive` flag.
  The single-threaded runner needs no scheduling change; the flag is the seam a
  future parallel scheduler would read to run such systems alone. `Commands`
  remains the default for gameplay — `world()` is the deliberate escape hatch.

- fad8a5e: feat: gizmos + debug-draw system and editor transform gizmos (ADR-0075)

  An engine-level, immediate-mode, world-space `Gizmos` debug-draw API rendered through a dedicated line pass, plus editor transform gizmos built on top of it. The gizmo pass renders into both `Core2d` and `Core3d`, after the transparent/post passes and before tonemapping, and gates each draw by the camera's render layers — a reserved `EDITOR_GIZMO_LAYER` keeps editor-only visuals out of the game view. This is the documented, scalable pattern for separating editor visuals from game visuals; the debug-draw API itself is exposable to user game code.

  **`@retro-engine/math`** — new geometry primitives for picking and gizmo math, projection-agnostic (correct under perspective and orthographic):

  - `Ray` + `Ray.fromScreen` (NDC → world ray unprojection, WebGPU `[0,1]` depth).
  - `rayPlaneIntersect`, `rayClosestPointToRay`, `signedAngleOnPlane`.
  - `screenSpaceScale` — world length that subtends a target pixel size, for constant-on-screen gizmo sizing.

  **`@retro-engine/engine`** — immediate-mode gizmo rendering:

  - `Gizmos` resource with `line` / `lineGradient` / `ray` / `circle` / `arc` / `sphere` / `cuboid` / `arrow` / `axes` / `grid`, each tagged with a render-layer mask and depth-test flag, cleared per frame.
  - `GizmoPlugin` (auto-added by `CorePlugin`), the `Core2d`/`Core3d` line pass, and `EDITOR_GIZMO_LAYER` / `EDITOR_GIZMO_MASK` for editor-only visuals.

  **`@retro-engine/editor-sdk`** — `TransformGizmo`: interactive Move / Rotate / Scale / All handles in 2D and 3D, editing one or more targets about their shared centroid, with constant on-screen sizing, a live drag readout (delta / angle / factor), and Escape-to-cancel.

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

- c4bf47a: feat(engine): Phase 12.1/12.2 — HDR per-camera + tonemapping

  Per ADR-0048, opens the post-processing chain. `Camera.hdr = true` now drives a per-camera `rgba16float` intermediate render target; a new `Tonemapping` per-camera component selects the display transform on the way to the camera's actual output. Geometry, transparent, and 2D light-composite passes write to `CameraView.mainColorTarget` (the HDR intermediate when `hdr = true`, or the camera's existing target when `hdr = false`); the new `TonemappingNode` appended to both `Core2d` and `Core3d` sub-graphs reads the HDR intermediate and writes the camera's final target. Material2d / Material3d / Sprite / 2D-light-composite pipeline keys now specialize on `view.mainColorTarget.format`, so the existing `PipelineCache` automatically specializes pipelines by `bgra8unorm` vs `rgba16float`. No new HAL, no new capability flag.

  **New public surface:**

  - `Tonemapping` (component) — `method: TonemappingMethod`.
  - `TonemappingMethod` — string-literal union: `'none' | 'reinhard' | 'reinhard_luminance' | 'aces_fitted' | 'agx' | 'blender_filmic' | 'somewhat_boring_display_transform'`.
  - `TONEMAPPING_METHODS` — frozen list of operator names.
  - `TonemappingPlugin` — auto-installed by `CorePlugin`; inserts the pipeline + node into both sub-graphs.
  - `CameraView.mainColorTarget: ResolvedRenderTarget` + `CameraView.hdr: boolean` — new fields. `mainColorTarget === target` for non-HDR cameras; for HDR cameras it points at a per-camera `rgba16float` intermediate.
  - `Camera2d({ hdr, tonemapping? })` / `Camera3d({ hdr, tonemapping? })` — bundle factories grow a `tonemapping?: TonemappingMethod` option; insert `Tonemapping({ method: 'agx' })` by default when `hdr: true` and no override is passed.

  **Behaviour changes:**

  - Cameras with `hdr: true` now allocate a per-camera `rgba16float` texture in `RenderSet.Prepare` (cached in a new `ViewHdrTargets` resource, GC'd at frame end like `ViewDepthCache`). Memory cost: one `width × height × 8 B` texture per HDR camera, returned when `hdr` flips back to `false`.
  - All geometry / composite pass nodes (`OpaquePass2dNode`, `TransparentPass2dNode`, `OpaquePass3dNode`, `TransparentPass3dNode`, `Light2dCompositePass2dNode`) write to `view.mainColorTarget.view` instead of `view.target.view`. For non-HDR cameras this is the same object reference — zero behavioural change.
  - The 2D `baseColor` intermediate (`ViewLight2dTargets.baseColorTex`) now follows `view.mainColorTarget.format`: `rgba16float` when HDR is on, otherwise the swapchain format (same as before). This preserves HDR values from the geometry passes into the light composite.
  - Material2d's pipeline key now reads `hdr` from `view.hdr` (previously hardcoded `false`); Material3d and Sprite specialization keys gain an `hdr: boolean` slot. The `PipelineCache` already hashes on color-target format, so pipelines automatically specialize without any cache change.

  **Out of scope (tracked):**

  - `tony_mc_mapface` operator — backlogged in `docs/backlog/tonemapping-tony-mcmapface.md`, gated on the asset system for HDR LUT loading.
  - MSAA × HDR — Phase 12.3.
  - Multi-pass post-processing chain (`main_texture` / `out_texture` ping-pong) — the trigger is Phase 12.4 (bloom).
  - `ColorGrading` (pre-tonemap exposure / contrast / saturation / gamma) — separate follow-on.

- 7812b83: feat(engine): `.hdr` HDRI import + equirectangular→cube conversion

  Per ADR-0106, completes roadmap Phase 10.7: an equirectangular Radiance `.hdr`
  can now be the source for both image-based lighting and the skybox (ADR-0105
  shipped those from a cube source). Decoder unit-tested; the equirect→cube path
  device-verified in `apps/playground` (`?mode=ibl&src=equirect`).

  **New public surface:**

  - `decodeRadianceHdr(bytes)` — pure Radiance RGBE decoder (new-style adaptive
    RLE + flat scanlines, `-Y h +X w` orientation) → linear float RGBA
    (`DecodedHdr`).
  - `createHdrImporter()` — `AssetImporter<Image>` decoding `.hdr` bytes into a
    linear `rgba16float` equirectangular (2D) `Image`. Register it with an
    `AssetServer` for the `'hdr'` extension (the studio's project loader does).
  - `decodeRadianceHdrPreview(bytes, maxDim)` / `HdrPreview` — a downsampled,
    Reinhard-tonemapped, sRGB-encoded RGBA8 preview of an HDR, for asset-browser
    thumbnails (does not materialize the full float buffer).
  - `EnvironmentCubeConverter`, `RenderEnvironmentCubes`,
    `ensureEnvironmentCubeResources`, `resolveEnvironmentCubeView`,
    `ResolvedEnvironmentCube`, `EQUIRECT_TO_CUBE_WGSL` — shared on-demand
    equirectangular→cube conversion (six GPU render passes, cached by source).

  **Behaviour changes:**

  - `RenderImage` gained a `dimension` field so the skybox / environment systems
    can distinguish an equirectangular (`'2d'`) source from a `'cube'` one and
    convert the former. Any code constructing a `RenderImage` literal must now set
    `dimension`.
  - `Skybox` and `EnvironmentMapLight` accept either a cube or an equirectangular
    `Image` handle; equirectangular sources are converted to a cube once and
    cached (the derived cube is runtime-only, never serialized).

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

- be4aad1: feat(engine): Image asset + handle-mode bind-group schema + StandardMaterial / UnlitMaterial default-fallback textures

  Adds an `Image` asset that mirrors the existing `Mesh` asset machinery: a value class with attached `SamplerDescriptor`, an `Images` registry with branded `ImageHandle`, an `ImagePlugin` extract+prepare chain that promotes images to GPU `Texture` / `TextureView` / `Sampler` via `RenderImages`, and three pre-seeded defaults (`Images.WHITE`, `.BLACK`, `.NORMAL_FLAT`) so material schemas can fall back to them ergonomically. Per ADR-0030.

  The bind-group schema (`BindGroupEntry<M>`)'s `texture` and `sampler` variants gain an `imageMode` discriminant — `'handle'` (resolves an `ImageHandle | undefined` field through `RenderImages`, falling back to a named default declared via `fallback: 'white' | 'black' | 'normalFlat'`) and `'view'` / `'sampler'` (raw escape hatch, today's behaviour). The walker (`prepareBindGroup`) threads `Images` + `RenderImages` parameters and applies the fallback chain.

  `UnlitMaterial` and `StandardMaterial` migrate to the new shape: every texture / sampler field becomes `ImageHandle | undefined`. `new StandardMaterial({ baseColor })` and `new UnlitMaterial({ color })` now produce usable materials with zero texture plumbing — the schema's per-entry fallbacks resolve missing slots through the pre-seeded defaults.

  **New public surface:**

  - `Image` — CPU-side texture asset (data + format + dimensions + sampler). Static factories: `Image.solid(rgba)`, `Image.checker(size, a, b)`, `Image.fromBytes(init)`. **Shadows DOM `HTMLImageElement`** when imported (use `window.Image` if you need the DOM constructor in the same file).
  - `Images` — main-world registry. API: `add(image): ImageHandle`, `get(handle)`, `replace(handle, image)`, `remove(handle)`, `has`, `size`, `iter`, `drainPendingChanges`. The constructor seeds three readonly defaults: `WHITE`, `BLACK`, `NORMAL_FLAT`.
  - `ImageHandle` — branded `number`, opaque identifier.
  - `ImageAssetEvent` — `{ kind: 'added' | 'modified' | 'removed'; handle: ImageHandle }`.
  - `ImagePlugin` — engine-internal plugin owning the data layer; registered by `CorePlugin` alongside `MeshPlugin`. Its prepare system is labelled `'image-prepare'`; `MaterialPlugin<M>`'s prepare declares `after: ['image-prepare']`.
  - `RenderImages` — render-world `Map<ImageHandle, RenderImage>`. `RenderImage = { texture, view, sampler }`.
  - `ExtractedImageAssetEvents` — App-scoped queue bridging extract and prepare.
  - `ImageDimension` — `'2d' | '3d' | 'cube'`. Type-level support; runtime walker throws on cube / 3D until a real consumer (skybox, volumetrics) lights them up.
  - `bytesPerTexel(format)` — helper for the supported sampled colour formats.
  - `ImageFallback` — `'white' | 'black' | 'normalFlat'`. Used by handle-mode schema entries.

  **Breaking changes:**

  - `UnlitMaterial.colorSampler` field removed. `UnlitMaterial.colorTexture` retyped from `TextureView | undefined` to `ImageHandle | undefined`. Constructor `init.colorTexture` follows.
  - `StandardMaterial.materialSampler` field removed. All five texture fields (`baseColorTexture`, `metallicRoughnessTexture`, `normalMapTexture`, `emissiveTexture`, `occlusionTexture`) retyped from `TextureView | undefined` to `ImageHandle | undefined`. Constructor `init` shape follows. The PBR shader (`pbr.wgsl`) is unchanged — the binding-2 sampler now resolves through `baseColorTexture`'s `Image` (all five PBR taps share it).
  - `BindGroupEntry<M>`'s `texture` and `sampler` variants now require an `imageMode` field. Authors migrate by adding `imageMode: 'handle'` + `fallback: 'white' | 'black' | 'normalFlat'` (the new ergonomic shape) or `imageMode: 'view'` / `'sampler'` (preserves today's raw-binding behaviour).
  - `prepareBindGroup` signature gains `images: Images` and `renderImages: RenderImages` parameters (between `scratch` and `label`).

  **Limitations (deferred):**

  - `Image.mipLevelCount > 1` throws at upload time. The field stays on `Image` for future expansion.
  - Cube and 3D image binding through materials throws — type-level support is for ADR-0030's future consumer story.
  - No file loaders (PNG / KTX2 / etc.) — Phase 11.5 (asset system).

- 88d0fc5: feat(engine): inline observer binding for scenes — bind named handlers in scene data

  Per ADR-0068, `scenes-and-prefabs.md` phase 5. A scene can now attach **entity-targeted observers** to its entities by referencing **registered handler names** — the third BSN-inspired pillar, where a scene describes behavior, not just data. The observer _runtime_ already existed (ADR-0013); this is the serializable binding layer on top of it. Modeled on Unity's UnityEvents (serialize the handler name, resolve at load); the handler itself is code and is never serialized.

  **New public surface:**

  - `defineObserverHandler({ name, event, params, run })` / `ObserverHandler`, `ObserverHandlerDefinition` — bundle the event a handler observes, its `Param[]`, and the body, under a stable, minification-safe name.
  - `App.registerObserverHandler(handler)` / `ObserverHandlerRegistry` — register a handler by name (from a plugin's `build()`) so a scene can attach it; duplicate name throws.
  - `SerializedObserverBinding` (`{ handler: string }`) and an optional `observers?` field on `SerializedEntity` — a scene names the handlers to attach to an entity; `spawnScene` resolves and attaches each through the same `commands.entity(e).observe` path, so lifecycle hooks fire and teardown is automatic.

  **Semantics:** scenes bind entity-targeted observers only (global/app-level observers stay app code). A binding names a handler and nothing else — the handler carries the event, so no separate event registry is needed. Resolution throws on an unregistered handler name. Teardown reuses the existing despawn path (`clearTargetedFor`), so tearing down a scene drops its bound observers automatically. Serialization never emits bindings — like template refs, a binding is authoring/source-side, not recovered from a live world.

  `SCENE_FORMAT_VERSION` stays `1` — the `observers` field is additive and optional, so existing scenes are byte-identical.

- 01070b1: feat(engine): GPU-instanced 3D / 2D mesh-material rendering

  Mesh-material entities are now drawn with GPU instancing instead of one draw
  call per entity. Renderables are batched by `(camera, alpha bucket, mesh,
material)`; each batch packs its per-instance transforms into one shared vertex
  buffer (`stepMode: 'instance'`, one `writeBuffer` per material type per frame)
  and emits a single instanced `drawIndexed`. N copies of a mesh collapse from N
  draws + N buffer uploads to O(batches). Opaque / alpha-mask 3D batches group
  freely (the depth buffer resolves order); transparent 3D and all 2D buckets stay
  depth-ordered and merge only adjacent same-key runs. Sealed in ADR-0038.

  This removes the per-entity `@group(1)` transform uniform and
  `EntityTransformGpuCache`; the per-entity draw-closure GC churn goes with it.

  **Breaking — custom material WGSL only.** The bind-group layout is renumbered:
  material resources move from `@group(2)` to `@group(1)` (view stays `@group(0)`).
  A material that reuses a built-in vertex shader only needs that `@group(2)` →
  `@group(1)` change. A material with a fully custom vertex shader must also drop
  the old `EntityTransform` uniform and read the model matrix from per-instance
  vertex attributes at `@location(8..11)` (plus the inverse-transpose at
  `@location(12..15)` for lit shaders). TypeScript material definitions and entity
  spawning are unchanged. All built-in materials (`UnlitMaterial`,
  `StandardMaterial`, `ColorMaterial2d`) are migrated.

  Removed exports: `EntityTransformGpuCache`, `ensureEntityTransform`,
  `gcEntityTransforms`, `ENTITY_TRANSFORM_BUFFER_SIZE`, `MeshTransformGcPlugin`.

- b788a60: feat(engine): 2D light kinds (spot/directional/ambient) + composite modes — Phase 9.1/9.3

  Completes roadmap §9.1 (the remaining 2D light components) and §9.3 (the `add` / `screen` composite modes) on top of [ADR-0037](../docs/adr/ADR-0037-point-light-2d.md)'s accumulation/composite foundation. Per ADR-0041. Every light kind shares one instance buffer and resolves in a single instanced accumulation draw — a per-instance `kind` discriminator selects geometry in the vertex shader and falloff in the fragment shader, so adding kinds adds no draw calls. Nothing in ADR-0037 is superseded.

  **New public surface:**

  - `SpotLight2d` — `{ color: Vec3; intensity: number; range: number; radius: number; direction: Vec2; innerAngle: number; outerAngle: number }`. A point light's radial falloff masked by an angular cone: `smoothstep(cos(outerAngle), cos(innerAngle), dot(direction, toFragment))`. `innerAngle`/`outerAngle` are half-angles in radians.
  - `DirectionalLight2d` — `{ color: Vec3; intensity: number; direction: Vec2 }`. A positionless, full-screen flat add modelling a far-away source. Its `direction` has no visible effect until normal-map-aware lighting (§9.5) lands — until then it reads as a uniform directional ambient wash.
  - `AmbientLight2d` — `{ color: Vec3; intensity: number; halfExtents?: Vec2 }`. A flat regional ambient zone: a world-space rectangle centred on the entity's `GlobalTransform` when `halfExtents` is set, summed additively over the global `Light2dSettings.ambient` floor. Without `halfExtents` it is global and equivalent to raising `Light2dSettings.ambient` (prefer the setting for a single floor).
  - `SpotLight2dOptions`, `DirectionalLight2dOptions`, `AmbientLight2dOptions` — constructor input shapes.
  - `Light2dKind` — `{ Point, Spot, Directional, AmbientZone }` instance discriminator constants.
  - `packSpotLightInstance`, `packDirectionalLightInstance`, `packAmbientLightInstance` — per-kind pack functions exposed for tests / benches / custom plugins.

  All three light components auto-attach the canonical `Transform + GlobalTransform + Visibility + InheritedVisibility + ViewVisibility` chain, identical to `PointLight2d`.

  **Composite modes:**

  - `Light2dSettings.compositeMode` now honours all three values: `'multiply'` (`base * light`), `'add'` (`base + light`), `'screen'` (`1 - (1 - base)(1 - light)`). The composite pipeline is specialised per mode (one fragment entry point each) rather than branching per pixel; `Light2dCompositeKey` gains a `compositeMode` field.

  **Behaviour changes (non-breaking):**

  - `LIGHT2D_INSTANCE_BYTE_SIZE` is now `52` (was `32`) and `LIGHT2D_INSTANCE_FLOAT_COUNT` is now `13` (was `8`) — three `float32x4` slots plus a trailing `float32` kind. Code reading these constants is unaffected; code that hard-coded `32` / `8` for the 2D-light instance layout must use the constants.
  - `light2d-queue` now extracts and packs `SpotLight2d` / `DirectionalLight2d` / `AmbientLight2d` alongside `PointLight2d`. The batching shape (one batch per Core2d camera) is unchanged.

- a3b6d83: feat(engine): normal-map-aware 2D lighting — Phase 9.5

  Adds per-pixel `N·L` shading for 2D sprites carrying a normal map, completing Phase 9. Per ADR-0043 (extends ADR-0037). A dedicated normal prepass captures normal-mapped sprites into a per-camera normal G-buffer, and point / spot / directional lights shade by `max(0, dot(N, L))`. The prepass route (rather than a second MRT target on the geometry passes) keeps the `Material2d` single-target contract intact and leaves accumulation running before the color geometry passes — so nothing in ADR-0037 is superseded. No GPU capability is required.

  **New public surface:**

  - `Sprite.normalMap?: ImageHandle` (+ `SpriteOptions.normalMap`) — optional tangent-space normal map, sampled with the sprite's UVs. No effect unless normal mapping is enabled.
  - `Light2dSettings.normalMapping` (boolean, default `false`) — opt-in for normal-map shading.
  - `Light2dSettings.normalLightHeight` (default `64`) — world-space height of 2D lights above the sprite plane, used as the Z of the light vector in `N·L`.
  - `Light2dNormalState` — render-world resource owning the normal-capture pipeline, instance buffer, and `(enabled, height)` uniform.
  - `Light2dNormalPrepass2dNode`, `Light2dNormalPrepass2dLabel` — Core2d node that captures normal-mapped sprites, ordered before the shadow + accumulation passes.
  - `LIGHT2D_NORMAL_FORMAT` (`'rgba8unorm'`), `LIGHT2D_DEFAULT_LIGHT_HEIGHT` (64).

  **Behaviour changes (non-breaking):**

  - The Core2d sub-graph gains the normal prepass node when `Light2dPlugin` is installed. Final chain: `Light2dNormalPrepass2d → Light2dShadowPass2d → Light2dAccumulationPass2d → OpaquePass2d → TransparentPass2d → Light2dCompositePass2d`.
  - `Light2dPlugin` inserts a `Light2dNormalState` resource and registers a `light2d-capture-normals` system; each Core2d camera gains a normal target + accumulation `@group(2)` bind group.
  - With `normalMapping` enabled, all sprites shade by `N·L` (un-mapped surfaces use a flat normal facing the viewer); the default `false` preserves flat lighting exactly.

  **Limits (v1):** sprite rotation is not applied to sampled normals; one global light height (not per-light); only sprites carry normal maps (`Material2d` / meshes do not).

- 43cae6c: feat(engine): Phase 9.1 — `PointLight2d` + accumulation/composite passes

  Phase 9.1 ships the smallest viable 2D-lighting end-to-end on top of the Phase 8.x sprite + Material2d Core2d sub-graph. Per ADR-0037. A new `Light2dPlugin` restructures the per-camera 2D draw chain into base-color → accumulate → composite, and a new `PointLight2d` component contributes additive radial light into the per-camera `lightAccum` texture. The composite pass multiplies the accumulated light against the geometry's base color and writes the product into the camera's actual target.

  When the plugin is **not** installed, every existing camera continues writing directly to its color target with zero behavior change — the redirect inside `OpaquePass2dNode` / `TransparentPass2dNode` falls back to `view.target.view` whenever no `ViewLight2dTargets` entry is present.

  **New public surface:**

  - `PointLight2d` — ECS component carrying `{ color: Vec3, intensity: number, range: number, radius: number }`. Auto-attaches the canonical `Transform + GlobalTransform + Visibility + InheritedVisibility + ViewVisibility` chain (mirrors `Sprite`).
  - `PointLight2dOptions` — input shape for the constructor.
  - `Light2dPlugin` — plugin owning the lighting pipeline. Registers WGSL modules, inserts resources (`Light2dPipeline`, `Light2dInstanceBuffer`, `Light2dPreparedBatches`, `ViewLight2dTargets`, `Light2dSettings`), wires two new render-graph nodes into the `Core2d` sub-graph, and registers `light2d-prepare-targets` (Prepare) + `light2d-queue` (Queue) systems.
  - `Light2dSettings` — `{ ambient: Vec4; compositeMode: 'multiply' | 'add' | 'screen' }`. v1 implements only `'multiply'`; `add` and `screen` are reserved per ADR-0037 §"Not yet done".
  - `Light2dCompositeMode` — string union for the field above.
  - `ViewLight2dTargets` — per-camera GPU-texture cache (baseColor + lightAccum + composite bind group), keyed by main-world camera entity. Lifecycle mirrors `ViewDepthCache`.
  - `Light2dCameraTargets` — one cache entry's shape.
  - `Light2dPipeline` — render-world resource owning the accumulation pipeline and the surface-format-specialized composite pipeline plus the shared quad VBO/IBO and sampler.
  - `Light2dCompositeKey` — specialization key for the composite pipeline (varies on `surfaceFormat`).
  - `Light2dInstanceBuffer` — growable per-light VBO (mirrors `SpriteInstanceBuffer`'s 1.5× growth + one-frame quarantine pattern).
  - `Light2dPreparedBatches`, `Light2dBatch` — per-camera batch records emitted by the queue system.
  - `LIGHT2D_ACCUM_FORMAT` (`'rgba16float'`), `LIGHT2D_INSTANCE_BYTE_SIZE` (32), `LIGHT2D_INSTANCE_FLOAT_COUNT` (8) — instance-layout constants.
  - `LIGHT2D_ACCUMULATION_WGSL`, `LIGHT2D_COMPOSITE_WGSL` — WGSL source.
  - `packLightInstance`, `prepareLight2dTargets` — pure functions exposed for tests / benches / custom plugins.
  - `Light2dAccumulationPass2dNode`, `Light2dAccumulationPass2dLabel`, `Light2dCompositePass2dNode`, `Light2dCompositePass2dLabel` — render-graph nodes inserted by the plugin into the `Core2d` sub-graph.

  **Behaviour changes (non-breaking):**

  - `OpaquePass2dNode` and `TransparentPass2dNode` now redirect their color attachment to a `ViewLight2dTargets`-backed baseColor texture when one exists. Cameras with no entry (no Light2dPlugin, or non-Core2d cameras) keep writing directly to their target view — the pre-Phase-9.1 behaviour is preserved exactly.
  - The `Core2d` sub-graph gains two optional nodes when `Light2dPlugin` is added. Resulting chain for a Core2d camera with lighting installed: `Light2dAccumulationPass2d → OpaquePass2d → TransparentPass2d → Light2dCompositePass2d`.

- 90a56e2: feat(engine): 2D shadow occluders via per-light 1D shadow maps — Phase 9.4

  Adds line-of-sight 2D shadows for `PointLight2d` / `SpotLight2d`. Per ADR-0042 (extends ADR-0037). A new `LightOccluder2d` component defines segment occluders; a shared shadow atlas stores a 1D nearest-occluder-distance map per shadow-casting light, built analytically each frame, and the accumulation pass samples it to mask occluded fragments. The shadow test is `O(1)` per shaded fragment, and ADR-0037's single instanced accumulation draw is preserved — scenes without occluders pay nothing new. No GPU capability is required (uniform buffers + a float render target only).

  **New public surface:**

  - `LightOccluder2d` — `{ segments: ReadonlyArray<[Vec2, Vec2]> }` in local space, transformed to world space by the entity's `GlobalTransform`. Statics `LightOccluder2d.fromPolygon(points, closed?)` and `LightOccluder2d.rect(halfWidth, halfHeight)`. Auto-attaches the canonical visibility/transform chain; an invisible occluder casts no shadow.
  - `LightOccluder2dOptions`, `OccluderSegment` — input shape + segment type.
  - `Light2dShadowState` — render-world resource owning the shadow atlas (`256 × 64` `rgba16float`, one row per caster), the analytic build pipeline, and the per-frame occluder/light uniform.
  - `Light2dShadowPass2dNode`, `Light2dShadowPass2dLabel` — Core2d node that builds the atlas once per frame, ordered before accumulation.
  - `LIGHT2D_SHADOW_WGSL` — the build shader source.
  - `LIGHT2D_SHADOW_ATLAS_WIDTH` (256), `LIGHT2D_MAX_SHADOW_CASTERS` (64), `LIGHT2D_MAX_OCCLUDER_SEGMENTS` (256), `LIGHT2D_SHADOW_ATLAS_FORMAT` (`'rgba16float'`) — budgets / format.

  **Behaviour changes (non-breaking):**

  - `LIGHT2D_INSTANCE_BYTE_SIZE` is now `56` (was `52`) and `LIGHT2D_INSTANCE_FLOAT_COUNT` is now `14` (was `13`) — a trailing `shadowRow` float. The `pack*` functions gain a `shadowRow` parameter (`packLightInstance` / `packSpotLightInstance`); directional / ambient instances pack `-1`. Code reading the layout constants is unaffected.
  - The Core2d sub-graph gains the shadow node when `Light2dPlugin` is installed. Final chain: `Light2dShadowPass2d → Light2dAccumulationPass2d → OpaquePass2d → TransparentPass2d → Light2dCompositePass2d`.
  - `Light2dPlugin` inserts a `Light2dShadowState` resource and registers a `light2d-prepare-shadows` system; `light2d-queue` now also collects occluders and assigns shadow rows.

  **Limits (v1):** segment occluders only; up to 256 segments and 64 shadow-casting lights per frame (overflow renders unshadowed); directional/ambient lights are unshadowed; soft edge is a fixed bias band.

- 88d3ca3: feat(engine): Phase 10.1/10.3 — 3D analytic lights + `GpuLights` uniform + simple-forward shading

  Phase 10.1 ships the first 3D-lighting slice on top of the Phase 7 material/Core3d path. Per ADR-0044. `StandardMaterial`'s `pbr.wgsl` previously evaluated Cook-Torrance against a single hardcoded directional light + constant ambient; it now reads scene-placed analytic lights from a `GpuLights` uniform and loops over every light (simple forward), with ambient from the uniform.

  A new `Light3dPlugin` registers the lights infrastructure; `StandardMaterial` now **requires** it (its shader imports `retro_engine::light3d` and binds the lights group at `@group(2)`). Unlit materials are unaffected.

  Clustered forward+ (roadmap 10.2/10.3 cluster half) is backlogged; IBL (10.7) remains gated on the asset system.

  **New public surface:**

  - `PointLight3d` — `{ color: Vec3, intensity, range, radius }`. Auto-attaches `Transform + GlobalTransform + Visibility + InheritedVisibility + ViewVisibility`.
  - `SpotLight3d` — point fields + `{ innerAngle, outerAngle }`. Cone direction derives from `GlobalTransform` forward (−Z) — no explicit direction field.
  - `DirectionalLight3d` — `{ color, intensity }`; direction from `GlobalTransform` forward (−Z); position ignored.
  - `AmbientLight` — **resource** (not a component) `{ color: Vec3, brightness: number }`. `Light3dPlugin` inserts a dim default.
  - `PointLight3dOptions`, `SpotLight3dOptions`, `DirectionalLight3dOptions`, `AmbientLightOptions` — constructor input shapes.
  - `Light3dPlugin` — registers the `retro_engine::light3d` WGSL, inserts `GpuLights` + `AmbientLight`, and runs the `light3d-prepare` (Prepare) system that packs every visible light into the uniform each frame.
  - `GpuLights` — render-world resource owning the fixed-capacity uniform buffer (`@group(2) @binding(0)`) and its bind group.
  - `GPU_LIGHTS_BYTE_SIZE` (7328), `GPU_LIGHTS_FLOAT_COUNT` (1832), `MAX_DIRECTIONAL_LIGHTS` (4), `MAX_POINT_LIGHTS` (64), `MAX_SPOT_LIGHTS` (64) — layout constants.
  - `packDirectionalLight`, `packPointLight`, `packSpotLight`, `packAmbient`, `packCounts`, `forwardFromMatrix` — pure packers exposed for tests / benches / custom plugins.
  - `LIGHT3D_WGSL` — WGSL source (`GpuLights` struct, `@group(2)` binding, per-light sample helpers).

  **Behaviour changes:**

  - `MaterialCtor` gains an optional static `usesLights` flag; when set (as on `StandardMaterial`), `MaterialPlugin` appends the lights bind-group layout so lit pipeline layouts are `[view, material, lights]`. Unlit materials keep `[view, material]`.
  - `OpaquePass3dNode` / `TransparentPass3dNode` bind the lights group at `@group(2)` when a `GpuLights` resource is present (no-op for unlit pipelines and for scenes without `Light3dPlugin`).
  - **Requires `Light3dPlugin`:** `StandardMaterial` no longer renders without it (the shader module + lights layout would be absent). Add it alongside `StandardMaterialPlugin` + `MaterialPlugin(StandardMaterial)`.

- 68ce298: feat(engine): `Local<T>` system param — per-system persistent state

  Adds the `Local` system param (P1 system-param sugar): per-system persistent
  state for accumulators, frame counters, and system-private caches, matching
  Bevy's `Local<T>`.

  - `Local(factory)` declares a param whose value lives in a `LocalState<T>`
    (`.current`). It is lazily seeded from `factory` on the system's first run,
    then the same slot is handed back every subsequent run, so writes to `.current`
    persist across frames.
  - Each `Local(...)` call owns a distinct slot, so two systems declaring
    `Local(() => 0)` never share state.

  Unit-tested: lazy factory seeding + write persistence across frames, per-system
  isolation, and a non-primitive (array) slot growing across frames.

- b5e3322: feat(engine): loose image importer (PNG/JPEG/WebP → Image)

  The `Image` asset kind and store already existed, but only `.hdr` had a decoder
  wired — a dropped-in `.png` / `.jpg` / `.webp` had no loader, so a loose color
  texture could not be loaded or assigned to a material (glTF-embedded textures
  were unaffected; they decode through the glTF importer).

  Adds `createImageImporter(decode?)` → `AssetImporter<Image>`, decoding a loose
  PNG/JPEG/WebP into an sRGB color image (`rgba8unorm`) via `createImageBitmap` +
  `OffscreenCanvas` (`createImageBitmapRgbaDecoder`, injectable for headless
  environments). The studio registers it for `png`/`jpg`/`jpeg`/`webp`, so a loose
  texture now loads through the asset server and binds like any other image.

- 10bda28: feat(engine): `MainCamera` marker designating the primary game view

  Per ADR-0081, adds a pure marker component that designates the principal game camera — the one a player sees through and a host (such as an editor) drives into its main viewport. It is a _designation_, not a render input: the render loop never consults it (which camera draws where stays governed by `Camera.target` / `Camera.order` / `Camera.isActive`); it exists so tooling and gameplay code can locate the principal camera by a stable query rather than by name or render order, mirroring Unity's `Camera.main`.

  **New public surface:**

  - `MainCamera` — empty marker component. Reflection-registered by `CameraPlugin` as `{ name: 'MainCamera' }`, so it round-trips in any saved scene. A scene is expected to carry at most one; the engine does not enforce or auto-assign it.

- ca1cafa: feat(engine): MakeHuman rig + skin-weights parsers

  The skeleton foundation for the RetroHuman preset (Phase 5). Parses the CC0 MakeHuman rig data so the
  base mesh can be skinned and animated.

  - `parseMakeHumanRig` → `MakeHumanRig`: bones (`name`, `head`, `tail`, `parent`) from a
    `rig.<name>.json`, ordered topologically (every bone after its parent) with a name→index map, so a
    bone's index is a stable joint index.
  - `parseMakeHumanWeights` → `SkinWeights`: inverts a `weights.<name>.json` (`bone → [vertex, weight]`)
    into per-vertex top-4 influences (`JOINTS_0` + normalized `WEIGHTS_0`, keyed by joint index),
    unweighted vertices pinned to the root.

  Reimplemented from the open/CC0 format (MakeHuman code is GPL — not copied). Unit-tested and verified
  on the real 53-bone `game_engine` rig: topological order holds, and all 19,158 base vertices' weights
  normalize to 1.

- e97fdd2: feat(engine): MakeHuman `.target` ingestion — sparse morph-target assets

  Ingests MakeHuman's topology-locked `.target` files as discoverable engine assets, the edit-time
  full-customization data RetroHuman's character creator composes onto a base mesh (ADR-0130).

  - `SparseMorphTarget` + `parseSparseMorphTarget` (`@retro-engine/engine`): a sparse per-vertex
    position delta set (`name`, `indices`, `deltas`) storing only moved vertices, with `maxIndex`,
    `fitsBase(n)`, and `toDense(n)`. The strict parser handles MakeHuman's `vertexIndex dx dy dz` lines
    (leading-dot floats, `#` comments) and throws on corruption.
  - Asset kind `'MorphTarget'` (extension `target`, discoverable, category `morph`): `SparseMorphTargets`
    store + `createSparseMorphTargetImporter`, registered by `MorphPlugin`. A loose `.target` file mints
    a `.meta` and loads through the AssetServer. Topology-lock (index-vs-base alignment) is validated at
    composition (`fitsBase`/`toDense`), since a `.target` carries no base-mesh reference.
  - `@retro-engine/editor-sdk`: a `'morph'` `AssetType` (scan-face icon) so the studio browser shows
    morph targets with their own category.

  Verified in the studio: a vendored MakeHuman `.target` dropped into a project is discovered, sidecar'd
  as `MorphTarget`, and loads into a `SparseMorphTarget` (311 vertices, indices within the base's 19,158).

- 3db9d87: feat(engine): manifest load-by-GUID so saved scenes survive a restart

  Per ADR-0066, the read half of the persistent asset tier. A scene serialized in one process now loads in a fresh one over the injected `AssetSource`: re-establish each referenced asset under its **original GUID**, then `spawnScene(app, scene)` resolves with **no caller-injected `resolveHandle`** (the ADR-0065 default resolver finds the loaded handle because it reaches the store carrying its GUID). Browser-native — `FetchAssetSource` reads bytes over HTTP, no filesystem needed. The write/save path, disk/bundle sources, and `.meta` sidecars (ADR-0055 phases 4–6) remain out of scope.

  **`@retro-engine/assets`:**

  - `parseAssetManifest(text)` folds the on-the-wire JSON shape (`AssetManifestFile { version, entries }`) into an `AssetManifest` keyed by GUID, rejecting a version mismatch, a duplicate GUID, or a malformed entry. `MANIFEST_FORMAT_VERSION` is the current wire version.
  - `Assets.reserveHandle(guid?)` gains an optional GUID (additive; default GUID-less, so `load` is unchanged). A slot reserved with a GUID is indexed by `byGuid` once the load drain fills it.

  **`@retro-engine/engine`:**

  - `AssetServer.loadByGuid<T>(guid)` — the GUID counterpart of `load(path)`. Resolves the GUID through the manifest to a location, then loads via the loader registered for the location's file extension; returns the handle synchronously, value arrives on the `PreUpdate` drain. Idempotent per GUID.
  - `AssetServer.setManifest(manifest)` / `loadManifest(location)` — adopt a manifest in memory, or read + parse one through the injected source.
  - Loader dispatch stays extension-keyed; the manifest's `kind` is carried as forward-compatible metadata. A missing manifest, an unknown GUID, or an extensionless/loader-less location throws.

  Coordination is preload-then-spawn: `loadManifest → loadByGuid → settle → drain → spawnScene`. `spawnScene` and the SceneRoot reactor are untouched. Selective/streamed scene loading is tracked for later.

- 0c7b778: feat(engine): Material2d + Mesh2d + ColorMaterial2d — shader-driven 2D geometry through Core2d

  Phase 8.7 lands the 2D analogue of Phase 7's `Material` / `Mesh3d` / `MeshMaterial3d<M>` trio, routed through Core2d's existing `ViewPhases2d` plumbing with no depth buffer. Per ADR-0035. `Mesh2d` wraps a `MeshHandle` (same shape as `Mesh3d`); `MeshMaterial2d<M>` pairs it with a `Material2d` implementation; `Material2dPlugin<M>` mirrors `MaterialPlugin<M>` byte-for-byte structure with three forced divergences — queue filters cameras by `view.subGraph === Core2dLabel`, phase routing follows `Material.alphaMode()` (lighting up the previously-empty `AlphaMask2d` slot for `'mask'` mode), and the specialized pipeline carries no depth-stencil dimensions. `ColorMaterial2d` ships as the reference material: a single packed UBO (`color: vec4f` + `alpha_cutoff: f32`) routed through `retro_engine::color_material_2d` WGSL. Bind-group layout matches `Material3d` exactly (`@group(0)` view, `@group(1)` entity transform, `@group(2)` material) so shader authors porting between the two only change vertex math, not slot numbers.

  **New public surface:**

  - `Material2d` (interface, extends `Material`), `Material2dCtor<M>`, `MaterialPipelineKey2d`, `Material2dPluginOptions`.
  - `Mesh2d` (component), `MeshMaterial2d<M>` (component).
  - `Materials2d<M>` / `RenderMaterials2d<M>` (type aliases over the 3D registry classes).
  - `Material2dPlugin<M>` (per-type subclass synthesis + prepare/queue systems).
  - `ColorMaterial2d` (reference material), `ColorMaterial2dPlugin` (idempotent WGSL registration), `COLOR_MATERIAL_2D_DEFAULT_MASK_CUTOFF`, `COLOR_MATERIAL_2D_WGSL`, `alphaBucketKey`.
  - `MeshTransformGcPlugin` — singleton GC system for `EntityTransformGpuCache` (idempotently inserted by every material plugin).

  **Behaviour changes (non-breaking):**

  - `ViewPhases2d.alphaMask` is no longer always-empty — `Material2d` with `alphaMode: { kind: 'mask', cutoff }` writes to this slot via a discard-based fragment path.
  - `EntityTransformGpuCache` GC moves to a standalone post-queue system in `RenderSet.PhaseSort`. `gcEntityTransforms`'s signature drops the `liveEntities` argument (now consumes `cache.liveThisFrame`, which `ensureEntityTransform` populates). Single-plugin behaviour is unchanged; multi-plugin coexistence is now race-free.
  - Core2d's `Opaque2d` and `AlphaMask2d` phases flip from front-to-back sort to back-to-front, matching `Transparent2d`. Z-axis layering for opaque content (e.g. Hollow Knight–style parallax with `Transform.translation.z`) now renders correctly without forcing `alphaMode: 'blend'` on every layer. All three Core2d phases are painter's-algorithm; the phase distinction is purely about blend state.

- 7142f6f: feat(engine): material system, Core3d phase trio, per-camera depth automation

  Phase 7 lands the material slice. The 436-LOC playground primitives showcase shrinks to 175 LOC of bundle-spawning — the Phase 7 boundary check from ADR-0028. Per ADR-0027, ADR-0028, and consuming ADR-0029's HAL extensions.

  **Material system (ADR-0028):**

  - `Material` interface, `MaterialPipelineKey` specialization key, `ShaderRef` / `ShaderRefs` for shader references.
  - `MaterialPlugin<M>` engine plugin: synthesises per-type subclasses of `Materials<M>` / `RenderMaterials<M>` / `MeshMaterial3d<M>` so the class-keyed ECS / resource store disambiguates material types at runtime despite TypeScript's erased generics. Registers extract / prepare / queue systems.
  - `Materials<M>` / `MaterialHandle<M>` / `RenderMaterials<M>` registries (mirrors `Meshes` / `MeshHandle` / `RenderMeshes`).
  - `Mesh3d` + `MeshMaterial3d<M>` components — spawn a drawable 3D mesh with `cmd.spawn(new Mesh3d(mh), new plugin.MeshMaterial3d(handle))`.
  - `EntityTransformGpuCache` resource: per-entity `@group(1)` uniform buffer + bind group, holding `model` and `inverse_transpose_model` matrices.
  - `ExtendedMaterial<Base, Extension>` wrapper with `forExtendedMaterial(Base, Extension)` factory: runtime schema concat with binding-offset shift, extension-shader overrides base, composed `specialize()`.

  **Bind-group schema (ADR-0027):**

  - `BindGroupSchema<M>` + `BindGroupEntry<M>` discriminated union (uniform / texture / sampler / storage buffer / storage texture).
  - `MaterialSchema(ClassRef, [...])` helper for compile-time refactor safety — renaming a material field surfaces a TS error on the schema entry. Raw object literals do not get this.
  - `schemaToBindGroupLayout`, `prepareBindGroup` walker: schema → `BindGroupLayout`; instance fields → uniform packing with WGSL `std140` alignment + `BindGroup` assembly.

  **Core3d phase trio:**

  - `Opaque3d` + `AlphaMask3d` + `Transparent3d` phase items in `ViewPhases3d`. Per-camera lists pushed by every `MaterialPlugin<M>`'s queue system; sorted front-to-back (opaque/mask) or back-to-front (transparent) by camera-space depth.
  - `OpaquePass3dNode`: opens color+depth pass (clear depth), binds view at `@group(0)`, draws opaque then mask items.
  - `TransparentPass3dNode`: opens second pass (load color+depth, depth-write disabled), binds view, draws transparent items.
  - `buildCore3dSubGraph` rewritten to `OpaquePass3dNode → TransparentPass3dNode`. `MainPassNode` stays in `Core2d`; Phase 8 will displace it there with the 2D phase trio.

  **Per-camera depth automation:**

  - `CameraDepthTarget` union: `'auto' | 'none' | { kind: 'manual', view, format }`. `Camera3d()` defaults to `'auto'`; `Camera2d()` defaults to `'none'`.
  - `ViewDepthCache` resource: per-camera depth-texture allocation, resizes on color-target change, garbage-collects entries for cameras absent from the current frame.

  **`@group(0)` view auto-bind:**

  - Every Core3d phase node + `MainPassNode` unconditionally `pass.setBindGroup(0, view.viewBindGroup)` right after `beginRenderPass`. Material pipelines lay out `@group(0) @binding(0)` for view data; consumers that re-bind `@group(0)` to their own data are unsupported (the contract is documented in `Material`'s TSDoc).

  **`PipelineCache.descriptorKey` expansion:**

  - Bug-fix prerequisite for materials: the descriptor key now includes depth-stencil state, cull mode, front face, per-target blend / write mask, and vertex buffer layout. Two materials varying any of these no longer silent-collide on the same cache slot.

  **`calculateBoundsSystem` body:**

  - ADR-0021's reserved slot is filled. Iterates `Mesh3d` entities without `NoFrustumCulling`, looks up the mesh asset, computes the AABB, writes the `Aabb` component. `NoFrustumCulling` doubles as the "I manage bounds myself" escape hatch.

  **Built-in materials:**

  - `UnlitMaterial` + `UnlitMaterialPlugin` — `color * texture(uv)` flat shading, the minimal Bevy parity.
  - `StandardMaterial` + `StandardMaterialPlugin` — metallic-roughness PBR (Lambert + GGX + Schlick) with all glTF texture slots. One hardcoded directional light + constant ambient as the Phase 7 placeholder; Phase 10's lighting and Phase 10.7's IBL replace the placeholders additively.

  **Playground refactor:**

  - `apps/playground/src/primitives-showcase-plugin.ts`: 436 LOC → 175 LOC, the ADR-0028 boundary check. No custom shader, no custom pipeline layout, no custom render-graph sub-graph, no manual depth texture. Spawn loop building `(Mesh3d, MeshMaterial3d<UnlitMaterial>, Transform)` bundles + a one-system rotator.

- eb3c452: feat(engine): materials as assets — `.remat` files, derived schema, kind-routed loading

  Per ADR-0107, material instances are now serializable, scene-referenceable assets (resolving the
  ADR-0028 open question; fulfilling ADR-0055's "material is always an asset"). The serialization
  schema is **derived from the material's bind-group schema**, so any material type — engine,
  `ExtendedMaterial`, or user-defined — becomes a `.remat` asset with no per-type code. Because
  `MeshMaterial3d<M>` already round-trips its handle by GUID, a scene's mesh→material reference now
  resolves on demand, which unblocks authoring PBR meshes in a scene.

  **New public surface:**

  - `materialReflectionSchema(ctor)` / `MaterialReflectSource` — derive a reflection `Schema` from a
    material's `static bindGroup` (+ optional `static serializedExtras`).
  - `createMaterialSerializer` / `createMaterialImporter` / `MATERIAL_FORMAT_VERSION` — the `.remat`
    codec round-trip (textures by GUID).
  - `MaterialTypes` / `MaterialTypeDescriptor` / `registerMaterialLoaders(app)` /
    `MATERIAL_ASSET_EXTENSION` — the per-type material registry + kind-keyed loader wiring.
  - `AssetServer.registerLoaderByKind(kind, store, importer)` — a kind-routed loader; `loadByGuid`
    prefers it over the extension loader when the manifest entry's kind matches.
  - `UniformField.semantic` (`'color'`) / `UniformField.meta` — optional, GPU-irrelevant annotations
    that flow into the derived schema for inspector UX (color pickers, ranges).

  **Behaviour changes:**

  - `MaterialPlugin<M>.build` additionally registers the material value type as a reflectable type,
    its `.remat` serializer, and a `MaterialTypes` descriptor. The kind loader is wired by
    `registerMaterialLoaders` once an `AssetServer` exists.
  - `StandardMaterial` / `UnlitMaterial` annotate their color/scalar fields and (StandardMaterial)
    declare `serializedExtras` for `depthBias` / `doubleSided`. `alphaMode` is not yet persisted.

- e6728cc: feat(mcp): asset.get / asset.setField / asset.save

  AI-driveable asset editing, mirroring the `component.*` commands but for a stored
  asset value (e.g. a material):

  - `asset.get` — an asset's serialized fields by GUID + kind (loads it if needed).
  - `asset.setField` — set one field; decoded into the field type (texture slots take
    an image GUID), routed through the scoped `History` (undoable + audited) and
    autosaved to the asset file.
  - `asset.save` — force an immediate write to the asset's project file.

  Adds `AssetServer.locationForGuid` (the manifest path for a GUID) so a save can
  resolve the target file. Verified live: `asset.setField roughness` persisted to the
  `.remat`, `history.undo` reverted + re-saved it, `asset.save` wrote on demand.

- 8029403: feat(engine, renderer): mesh asset + RenderMesh + MeshAllocator + primitives + HAL vertex/index extensions (Renderer Phase 6)

  The data layer Phase 7 (Material system) and Phase 8 (Sprites + Mesh2d) both block on. `Mesh`, `RenderMesh`, the page-based slab `MeshAllocator`, and the full primitive set ship together so Phase 7 wires up `Mesh3d` + `MeshMaterial3d<M>` against the final shape from day 1 — no draw-site refactor when materials land. Per ADR-0024 (mesh data + primitives + HAL extensions) and ADR-0025 (MeshAllocator).

  **Public surface (`packages/engine/src/mesh/`):**

  - `Mesh` — value class holding `attributes`, `indices?`, `primitiveTopology`, optional `label`. Builder API (`insertAttribute`, `withInsertedAttribute`, `setIndices`). Derived ops: `computeAabb`, `computeFlatNormals`, `computeSmoothNormals`, `checkConsistency`.
  - `MeshVertexAttribute` + `MeshVertexAttributeId` (branded number) + `MeshAttribute` const-namespace with the well-known slots `POSITION` (id 0), `NORMAL` (id 1), `UV_0` (id 2), `TANGENT` (id 4), `COLOR` (id 5) — ids mirror Bevy verbatim so a future glTF importer doesn't need a remap table.
  - `Indices` tagged union + `u16Indices` / `u32Indices` / `indicesFormat` / `indexByteSize` / `indexCount` helpers.
  - `RenderMesh` + `MeshVertexBufferLayoutRef` + `interMeshVertexBufferLayout` — RenderMesh carries no buffer offsets and no buffer handles; the allocator is queried at draw time. Layout refs are hash-consed for identity-equal dedupe.
  - `Meshes` — pre-asset-system registry mapping `MeshHandle` (branded number) → `Mesh`; emits `MeshAssetEvent` (`Added` / `Modified` / `Removed`) on every mutation. Folds into `Handle<Mesh>` + `AssetServer<Mesh>` when the asset system lands.
  - `MeshAllocator` + `MeshAllocatorSettings` — page-based slab suballocator over shared GPU buffers. Defaults `minSlabSize: 1 MiB`, `maxSlabSize: 64 MiB`, `largeThreshold: 16 MiB`, `growthFactor: 1.5`. Slabs key per `MeshVertexBufferLayoutRef` (vertex) and per `IndexFormat` (index). Large-threshold allocations bypass slabs and get a dedicated buffer. Gated on `RendererCapabilities.baseVertex` — when `false` (WebGL2), every vertex allocation routes through the dedicated-buffer path. Ref-counted lifetime; first-fit free-list with coalescing.
  - `MeshPlugin` — auto-registered by `CorePlugin` between `CameraPlugin` and `VisibilityPlugin` (so `calculateBoundsSystem` lands at the head of `VisibilityPlugin`'s documented `CalculateBounds → UpdateFrusta → VisibilityPropagate → CheckVisibility` order). Inserts `Meshes`, `MeshAllocator`, `MeshAllocatorSettings`, `ExtractedMeshAssetEvents`, `RenderMeshes`. Extract+prepare pipeline runs in `RenderSet.Extract` / `RenderSet.Prepare`, calling the allocator and populating `RenderMeshes`.
  - `calculateBoundsSystem` — reserved slot per ADR-0021. Empty body in Phase 6; fills with the mesh-driven auto-AABB writer when `Mesh3d` lands.
  - `Meshable` + `MeshBuilder` interfaces.
  - 3D primitives — `Cuboid`, `Sphere` (ico + uv kind), `Cylinder`, `Capsule3d`, `Torus`, `Plane3d`, `Cone`, `Tetrahedron`, `ConicalFrustum`.
  - 2D primitives — `Rectangle`, `Circle`, `Annulus`, `RegularPolygon`, `Triangle`, `Ellipse`.

  **HAL extensions (`packages/renderer-core`, `packages/renderer-webgpu`, `packages/renderer-webgl2`):**

  - `VertexFormat` (30 values mirroring WebGPU's `GPUVertexFormat`) + `vertexFormatByteSize` helper.
  - `IndexFormat` (`'uint16' | 'uint32'`) + `indexFormatByteSize` helper.
  - `VertexBufferLayout` / `VertexAttribute` / `VertexStepMode` types.
  - `VertexState.buffers?: readonly VertexBufferLayout[]` on `RenderPipelineDescriptor`.
  - `PrimitiveTopology` exported (was inline on `PrimitiveState.topology`).
  - `RenderPassEncoder.setVertexBuffer(slot, buffer, offset?, size?)`, `setIndexBuffer(buffer, format, offset?, size?)`, extended `draw(vertexCount, instanceCount?, firstVertex?, firstInstance?)`, new `drawIndexed(indexCount, instanceCount?, firstIndex?, baseVertex?, firstInstance?)`.
  - `RendererCapabilities.baseVertex: boolean` — `true` on WebGPU, `false` on the WebGL2 stub.

  **Bench:**

  - `packages/engine/bench/mesh-allocator.bench.ts` — three hot-path scenarios (steady-state allocate/free churn, grow under pressure, large-threshold burst). Joins the gate chain per CLAUDE.md §11.

  **Deferred (per ADR-0024 / ADR-0025 "Not yet done"):**

  - `Mesh3d` / `Mesh2d` ECS components, `MeshMaterial3d<M>` / `MeshMaterial2d<M>`, and mesh draw systems — Phase 7 (3D) / Phase 8 (2D `SpritePipeline`).
  - Skinning attributes (`JOINT_INDEX`, `JOINT_WEIGHT`) — Phase 11.5.
  - Morph targets — Phase 11.6.
  - `generateTangents` (MikkTSpace port) — when normal-mapped materials need it.
  - glTF attribute id 3 (second UV) — when a glTF mesh asks for it.
  - Slab compaction, best-fit policy, async upload, per-layout settings overrides — each waits for a measured trigger.
  - Asset-system `Handle<Mesh>` migration — when `@retro-engine/assets` lands.

- c049410: feat(engine): `.meta`-sourced manifest, no committed manifest or project.json (ADR-0089)

  `serializeProject` no longer writes a committed `assets.manifest.json` or a `project.json`
  index. Asset identity is the committed `.meta` sidecar (now `{ version, guid, kind }`), and
  the GUID→location manifest is rebuilt from sidecars on load via the new `scanMetaManifest`,
  adopted through the existing `AssetServer.setManifest`. `SavedProject` now exposes
  `scenes: { location, guid }[]` and a derived (not written) `manifest`.

  Removed from the public surface: `PROJECT_FORMAT_VERSION`, `ProjectDocFile`, and
  `serializeProject`'s `manifestLocation`/`projectDocLocation` options. The human-authored
  project descriptor (`project.retroengine`, TOML) is owned by the scaffolder/studio, not by
  `serializeProject`.

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

- 3658119: feat(engine): nested (recursive) blend trees in the animation controller

  Per ADR-0140 (supersedes ADR-0119's flat blend-tree child shape), a blend tree's
  children now hold a full nested `Motion` instead of a bare clip handle, so blend
  trees nest arbitrarily deep and each nested level can be driven by a different
  parameter than its parent — e.g. an 8-way directional 2D tree (`moveX`/`moveY`)
  whose every slot is a 1D idle → walk → run blend on a separate `speed` parameter.

  This is a clean break with no backwards compatibility: the flat child shape is
  replaced outright and the `.ranimctrl` wire format bumps to version 2, so old
  serialized controllers may fail to load.

  **Changed public surface:**

  - `Motion` — `blend1d`/`blend2d` children are now `{ motion, threshold }` /
    `{ motion, x, y }` (was `{ clip, threshold }` / `{ clip, x, y }`); a leaf is
    `{ kind: 'clip', clip }`.
  - `evaluateMotion` — recurses through nested motions; a leaf clip's weight is the
    product of every blend weight along its path times the crossfade weight. Its
    signature now takes a `MotionScratch` and a `depth` (replacing the flat weight
    scratch), and phase still propagates down unchanged so clips stay
    phase-synchronized across the whole structure.
  - `MotionScratch` — new pooled per-depth weight/position scratch keeping the
    recursive per-frame evaluation allocation-free.
  - `motionDuration` — recurses to the longest leaf-clip duration anywhere in the
    tree.
  - `weights1d` — widened to accept a `Float32Array` scratch (was `readonly number[]`).
  - `ANIMATION_CONTROLLER_FORMAT_VERSION` — bumped to `2`; the `.ranimctrl`
    serializer/importer round-trips the full recursive structure, emitting/resolving
    clip GUIDs only at the leaves.

- 3280a8e: feat(engine): `.obj` source meshes load as vertex-order base meshes

  Registers an `ObjMesh` asset kind (extension `obj`, discoverable, category `mesh`) so a Wavefront OBJ
  dropped into a project is discovered, sidecar'd, and loaded into the shared `Meshes` store via
  `parseObjBaseMesh` (the vertex-order-preserving loader from ADR-0131) — one mesh vertex per OBJ `v`
  line, so a MakeHuman `.target` keyed by `v` index aligns with it. A `Mesh3d` references the result
  like any other mesh.

  This is the morph-aligned base loader, not a general OBJ importer (positions stay in file order;
  seam UVs collapse to one per vertex). A general split-by-attribute OBJ import is deferred.

  Verified live: `base.obj` is discovered as `ObjMesh`, loads into a 19,158-vertex `Mesh`, renders, and
  the character-creator composition (sparse delta apply + `computeSmoothNormals` + re-upload via
  `Meshes.getMut`) reshapes it without disturbing the renderer.

- 62effe1: fix(editor-sdk): composition-aware play-mode snapshot (no duplicated glTF subtrees)

  The play-mode snapshot captured a scene's glTF-instantiated (and nested-scene)
  subtrees verbatim, then restore's `spawnScene` re-instantiated them — so every
  Play→Stop cycle duplicated a model's node tree.

  - `@retro-engine/engine`: `SerializeOptions` gains an optional `composition`
    (a `CompositionRegistry`); `serializeWorld` passes it to `collectComposition`
    so a bare-world caller can summarize derived subtrees to their authored root,
    the way `serializeScene` already does. Additive — existing callers are
    unchanged.
  - `@retro-engine/editor-sdk`: `capturePlaySnapshot` now supplies the App's
    `CompositionRegistry`, so the snapshot stays entities-only but excludes
    generated children. Restore respawns the authored roots, which re-instantiate
    their subtrees exactly once.

  Verified end-to-end in the studio via MCP: with the snapshot wiring installed, a
  Play→edit→Stop cycle reverts an authored entity (Health 150→110) and leaves the
  entity count unchanged (77 → 77) — the glTF character rig is no longer duplicated.

- ca677c6: feat(engine): prefab templates & patches — spawn, patch, and embed-in-scene

  Per ADR-0067, the prefab layer on top of scenes (`scenes-and-prefabs.md` phases 2–4). A **template** is a named, parameterized entity recipe — a declarative param schema (reusing the reflect `t` vocabulary, so params round-trip) plus an imperative `build` factory that produces component instances. Adapts Bevy BSN's _templates-produce-patches, one-shot-at-spawn_ model to our archetype World, reflection registry, and `resolveBundle` Required-Components mechanism. Templates are data + a closure over a per-App registry — no base class.

  **New public surface:**

  - `defineTemplate({ name, params, build })` / `Template`, `TemplateDefinition`, `ParamSchema`, `ResolvedParams`, `expandTemplate` — define a template; params are typed `FieldType`s with `.default()`/`.optional()`.
  - `spawnTemplate(app, template | name, params?)` — spawn a fresh entity, substituting params and resolving Required Components through the command buffer (hooks fire, `static requires` fill in).
  - `applyTemplate(app, entity, template | name, params?)` — apply a template as a patch to an existing entity: overwrite a present component, add a missing one, leave the rest.
  - `App.registerTemplate(template)` / `TemplateRegistry` — register by stable name so a scene (or `spawnTemplate(app, 'Name', …)`) resolves it.
  - `SerializedTemplateRef`, `SerializedOverride` and an optional `templates?` field on `SerializedEntity` — a scene embeds a template by name + params; `spawnScene` expands it, with per-instance field-level `overrides`.

  **Override semantics (locked):** one-shot, in two layers — typed `params` substitute into `build`, and a scene ref may additionally overlay field-level `overrides` onto the produced components (absent fields keep the template value). Nothing is tracked after spawn; serialization re-emits the expanded components, not the ref.

  `SCENE_FORMAT_VERSION` stays `1` — the `templates` field is additive and optional, so existing scenes are byte-identical. Inline observer binding (roadmap phase 5) is deferred on the not-yet-built observer system.

- 67e8513: feat(engine): project save tier — write a `.retro-project` through a browser sink (ADR-0070)

  The write half of the persistent asset tier (ADR-0055 phases 4–6), the symmetric mirror of the ADR-0066 read half. The serialization layer produces **pure data**; a swappable write **sink** on the same DI seam as `AssetSource` writes it. `@retro-engine/engine` and `@retro-engine/assets` import no Tauri, no Node `fs`, no platform write API — the native/disk sink drops in at the app layer, like the renderer backend.

  **`@retro-engine/assets`:**

  - `AssetSink { write(location, bytes): Promise<void> }` — the single-method write mirror of `AssetSource`.
  - `bakeManifest(entries)` / `serializeAssetManifest(file)` — the inverse of `parseAssetManifest`: `parseAssetManifest(serializeAssetManifest(bakeManifest(e)))` reproduces the entry map.

  **`@retro-engine/engine`:**

  - `serializeProject(app, opts)` → `SavedProject` — produces, as pure data, the manifest, the scene documents (each a GUID-addressable asset carrying its resources), promoted referenced-asset bytes, `.meta` sidecars, and the `.retro-project` index. No I/O — the caller writes `SavedProject.files` through an `AssetSink`.
  - `promoteAsset(handle, value, kind, serializer, opts)` — freezes a runtime asset's existing GUID into a project asset (bytes + manifest entry + `.meta`); the "CreateAsset analogue".
  - `AssetSerializers` + `registerAssetSerializer(app, kind, serializer)` — serializers become first-class like importers, registered per owning plugin. `createMeshImporter` / `createMeshSerializer` (`.rmesh`, `MESH_FORMAT_VERSION`) make a referenced mesh promotable and reloadable by `loadByGuid`.
  - `HttpPostAssetSink` (browser, `fetch` `PUT`) — the v1 sink; pairs with `FetchAssetSource` for a browser→disk→browser round-trip. `MemoryAssetSink` / `MemoryAssetSource` for in-process round-trips and tests. `ProjectSaveSink` holds the injected sink; `AssetPlugin` gains a `sink` option. `AssetStores.storeFor(kind)`.

  A whole project — scenes + resources + promoted assets — saves through a browser sink and reloads faithfully through the existing read path (`loadManifest → loadByGuid → spawnScene`) in a fresh App. The File System Access sink, native disk/bundle sinks, selective/streamed loading, and hot-reload remain deferred.

- 8ac39a9: feat(engine): garment proxy fitting — `.mhclo` parser + barycentric fit solve

  The core of clothes/hair that follow body _shape_ (RetroHuman Phase 4, ADR-0133). MakeHuman binds each
  garment ("proxy") vertex to a body base-mesh triangle by barycentric weights + a scaled offset, so a
  garment tracks the surface when the body is re-proportioned — not just posed.

  - `parseMhclo` → `ProxyFitting` (`@retro-engine/engine`): parses a `.mhclo` proxy file into flat
    per-proxy-vertex arrays — base triangle (`triIndices`), barycentric `baryWeights`, `offsets`, and
    optional `x/y/z_scale` references. Handles both 9-field triangle bindings and single-index exact
    bindings; throws on malformed lines.
  - `fitProxy(basePositions, fitting, out?)`: `pos = Σ wᵢ·base[triᵢ] + (sx·dx, sy·dy, sz·dz)`, where the
    per-axis scale is `|base[v1] − base[v2]| / den` (garment standoff tracks body proportions). Pure,
    `O(proxy vertex count)`, allocation-free with `out`. Benched (~48 µs for 16k proxy verts).

  Reimplemented from the open/CC0 algorithm (MakeHuman code is GPL — not copied). Unit-tested: a garment
  vertex follows its bound base triangle when the body morphs, and offsets scale with body proportions.
  Studio garment wiring (load a proxy, re-fit on morph, skin to the shared skeleton) is the next slice.

- 92d6c91: feat(engine): garment asset kind + studio fitting — clothes follow body shape

  Completes RetroHuman Phase 4 (ADR-0133): garments load as assets and follow the body when it morphs.

  - `ProxyPlugin` registers a `.mhclo` asset kind (`ProxyFitting`, discoverable, category `garment`):
    `ProxyFittings` store + `createProxyFittingImporter` (uses `parseMhclo`). The garment's geometry
    loads as an ordinary `ObjMesh` (vertex-order, so binding `i` pairs with proxy vertex `i`).
  - `@retro-engine/editor-sdk`: a `'garment'` `AssetType` (shirt icon) for the studio browser.
  - Studio character-creator panel: discovers `garment` assets, loads each fitting + its proxy mesh,
    spawns it as a sub-mesh, and re-fits (`fitProxy`) onto the live body on every morph edit.

  Verified live: a garment bound to nose-region base verts moved with the body (vertex Δy = −0.564 when
  the nose morphed), renderer healthy. Skeleton-driven pose-follow comes free once the shared skeleton is
  wired (Phase 5).

- 75a1a8a: feat(engine): cascade despawn via onRemove(Children/Parent) hooks (ADR-0014)

  `cmd.entity(e).despawn()` now cascades through `Children` and detaches the dying entity from its parent's `Children` list. The cascade and detach behaviours are driven by `onRemove` component hooks registered in `CorePlugin` — the first consumer of the hook surface shipped in ADR-0013.

  **Behavioural change (public surface):**

  - `cmd.despawn(parent)` despawns every descendant reachable through `Children`. Previously (per ADR-0010 §3) plain despawn was single-entity; cascades required `.despawnRecursive()`.
  - `cmd.despawn(child)` removes the child from its parent's `Children.entities` list. Previously this only happened via `.despawnRecursive()`.
  - Opt out of cascade by detaching with `cmd.entity(parent).removeChild(child)` before despawning, or by calling `world.despawn(e)` directly (raw world calls still bypass hooks per ADR-0013).

  **API surface:**

  - `EntityCommands.despawnRecursive()` survives as an alias for `.despawn()`. The call-site name remains for intent signalling; both share one code path.
  - `CommandOp` loses the `'despawnSubtree'` variant. Internal-only; no consumer touches `CommandOp` directly.

  **ADR provenance:**

  - Seals ADR-0014.
  - Supersedes ADR-0010 §3 (despawn semantics) and §7 (`despawnRecursive` mechanics). The rest of ADR-0010 (package boundary, propagation strategy, `cmd.spawn` return type, etc.) stays.
  - Consumes the hook surface from ADR-0013 §11/§16 as planned — no re-opening of ADR-0013.

- 5be634a: feat(reflect): register engine components + hook-firing `spawnScene` (ADR-0061)

  Makes reflection (ADR-0060) work on the engine's own content: real components register into a registry the App owns, and a new command-driven load brings a scene back live instead of inert. Closes the two follow-ups ADR-0060 reserved.

  **New public surface:**

  - `AppTypeRegistry` — the App's reflection registry resource (Bevy `AppTypeRegistry` analog), created in the App constructor. Per-App, not reflect's process-wide `defaultRegistry`.
  - `App.registerComponent(ctor, schema, opts?)` / `App.registerType(ctor, schema, opts?)` — register a type's schema in the App's registry. The `app.register_type` analog; owning plugins call it from `build()`.
  - `spawnScene(app, scene, registry?, opts?)` (+ `SpawnSceneOptions`) — load a `SceneData` through `Commands` with reserved ids, so component hooks fire, Required Components resolve, and the hierarchy wires (the `Parent` edge routed through `addChild`, rebuilding `Children`) before the flush. Complements the bare-`World` `deserializeScene`, which stays for tools/tests.
  - `serializeScene(app, opts?)` — serialize an App's world using the App's own registry. Pairs with `spawnScene`.

  **Behaviour:**

  - Core graph + one renderable family now register their schemas from their owning plugins: `Transform`, `Name`, `Parent` (CorePlugin), `Visibility` (VisibilityPlugin), `Mesh3d` (MeshPlugin), and per-type `MeshMaterial3d<M>` under the qualified name `MeshMaterial3d<MaterialName>` (MaterialPlugin). Derived/reciprocal components (`GlobalTransform`, the inherited/view visibility booleans, `Children`) are deliberately not registered — recomputed/rebuilt on load.
  - `serializeScene → JSON → spawnScene` round-trips a real parent/child engine graph: hierarchy remapped, `Children` rebuilt from the `Parent` edge, Required Components present, `GlobalTransform` recomputed by propagation, handles resolved by GUID onto the App's per-type material subclass.

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

- 056bfc9: feat: expose feature-component reflection registration independent of the plugins

  Each feature plugin now factors its component-schema registration into a standalone, exported function so a host (e.g. an editor's component palette) can register the component _types_ for authoring and serialization without installing the plugin's systems or render passes.

  New public surface:

  - `@retro-engine/physics-core`: `registerPhysicsComponents(app)` — all 2D/3D bodies, colliders, velocities, forces, materials, character controllers, and joints.
  - `@retro-engine/audio`: `registerAudioComponents(app)` — `AudioSource`, `AudioListener`.
  - `@retro-engine/input`: `registerInputComponents(app)` — `ActionBinding`/`ActionDef` value types + the `ActionMap` component.
  - `@retro-engine/ui`: `registerUiComponents(app)` — every UI component (layout, text, image, style class, button/toggle/slider/text-input, and the interaction/focus/diagnostics markers), plus the now-exported `uiButtonSchema` / `uiToggleSchema` / `uiSliderSchema` / `uiTextInputSchema`.
  - `@retro-engine/engine`: `registerSpriteComponents(app)`, `registerLight2dComponents(app)`, `registerTextComponents(app)` — the sprite (+ atlas), 2D light, and text component schemas.

  Each owning plugin's `build` now delegates to its function, so behavior is unchanged. Registering the same constructor twice is idempotent, so calling these alongside the full plugin is safe.

- 7dc7bca: feat(engine): render graph — `Node` / `ViewNode` / `RenderSubGraph` / `CameraDriverNode` / default `Core2d` & `Core3d` (Renderer Phase 5)

  The single hand-orchestrated per-camera loop in `App.renderFrame()` is replaced by a declarative graph. Every multi-pass feature downstream (sprite phases in §8, 2D lighting accumulate-then-composite in §9, post-processing in §12, prepasses in §12.8) plugs in as nodes inside a sub-graph instead of fighting the renderer's shape. Per ADR-0023.

  **Public surface (`packages/engine/src/render-graph/`):**

  - `RenderLabel` — branded string identifying a node or sub-graph; `createLabel(name)` constructor.
  - `Node` / `ViewNode` — pass-shaped unit of work; `ViewNode` is a `Node` that expects `ctx.view` (one invocation per active camera). Plain-object implementations, no base class.
  - `NodeRunContext` — per-invocation context; carries the App, the graph, the active encoder / pass / view, the render-set systems pre-grouped by `RenderSetName`, and the node's input slot values.
  - `SlotType` (`Entity` | `TextureView` | `Buffer` | `Sampler`) + `SlotInfo` / `SlotValue` / `SlotValues` — the type system for inter-node data flow. Day-1 nodes declare empty slot lists; the type machinery is in place for §5.5 transient resources to land without graph rewrites.
  - `RenderGraph` — top-level container: nodes + sub-graph registry, Kahn's topological sort, freeze-on-first-frame, throws on post-freeze mutation. Inserted as an App resource by `RenderGraphPlugin`.
  - `RenderSubGraph` — flat collection of nodes + ordering edges with its own topological sort. Cannot nest.
  - `CameraDriverNode` / `CameraDriverLabel` — root node; owns the per-frame encoder, iterates `SortedCameras`, dispatches each camera's sub-graph, submits.
  - `MainPassNode` / `MainPassLabel` — §5.7 shim. Inside each default sub-graph, opens the camera's render pass and runs `RenderSet.Render` systems with the active `RenderContext`. Existing render-stage systems work unchanged.
  - `Core2dLabel` / `Core3dLabel` + `buildCore2dSubGraph()` / `buildCore3dSubGraph()` — default sub-graph templates, each registering a single `MainPassNode` on day 1.
  - `RenderGraphPlugin` — installs the resource and the default sub-graphs at `build` time. Auto-registered by `CorePlugin` after `CameraPlugin` and `VisibilityPlugin`.

  **Camera surface:**

  - `Camera.subGraph: RenderLabel` — new inline field, defaults to `Core2dLabel`.
  - `Camera2d()` inherits the default; `Camera3d()` factory defaults to `Core3dLabel`.
  - `ExtractedCamera.subGraph` and `CameraView.subGraph` mirror the field through the render-set pipeline so `CameraDriverNode` reads it off the per-frame view.

  **Migration behaviour:**

  - `App.renderFrame()`'s per-camera lambda is gone; the body lives in `MainPassNode`. Every observable behaviour (passes per frame, `loadOp` / `clearValue` per camera, sort order, `RenderSet.Render` system invocations, fallback clear when no cameras, headless skip) is unchanged.
  - `App.runRenderSet` is now `@internal public` (was `private`) so `MainPassNode` can dispatch the render set. Downstream code outside the engine package should not call it directly.
  - A camera with a `subGraph` label no plugin has registered is skipped with a one-shot `devWarn`; rendering continues for the other cameras.

  **Deferred (per ADR-0023 "Not yet done"):**

  - Transient resource allocator (§5.5), cross-frame history resources (§5.6), and the studio render-graph visualiser (§5.8) ship with their first consumers (bloom / post, TAA, Phase 15 respectively).
  - Per-camera `ViewVisibility` (ADR-0021 open question) and `@group(0) = view` auto-bind (`docs/backlog/view-bind-group-zero-convention.md`) remain on their original triggers.

- 5c33631: feat(engine): render world + render schedule sets (ADR-0019)

  Closes Phase 1.4 + 1.5 of the renderer roadmap. The engine now hosts a second
  `World` for render-only data, plus a six-set sub-ordering inside the
  `'render'` stage. Backwards-compatible — existing render-stage systems
  default to the `Render` set and keep working unchanged.

  ### App.renderWorld

  A literal second `World` instance, peer to `app.world`. Render-stage system
  params resolve against it by default. Cleared at the start of every
  `renderFrame()` — entities do not persist across frames, but resources do.

  ```ts
  app.addSystem("render", [Query([ExtractedSprite])], (q) => {
    for (const [s] of q) record(s);
  });
  ```

  Read main-world data via the new `Extract<P>` wrapper:

  ```ts
  app.addSystem(
    "render",
    [Extract(Query([Sprite, GlobalTransform]))],
    (q) => {
      for (const [sprite, transform] of q) {
        app.renderWorld.spawn(new ExtractedSprite(sprite, transform.matrix));
      }
    },
    { set: RenderSet.Extract }
  );
  ```

  ### RenderSet

  `AddSystemOptions.set?: RenderSetName` slots a render-stage system into one
  of six sub-sets, run in fixed order each frame:

  ```
  Extract → Prepare → Queue → PhaseSort → Render → Cleanup
         (no encoder)        ↑ pass open ↑    (encoder finished)
  ```

  Systems with no explicit set default to `RenderSet.Render` — the existing
  single-pass behaviour. The `set` option is rejected at registration for any
  stage other than `'render'`.

  ### RenderCtx scope tightened

  `RenderCtx` was already render-stage-scoped at registration; it now also
  checks at resolve time that the active set is `RenderSet.Render` (the only
  set where the pass encoder is open). Using it in Extract / Prepare / Queue
  / PhaseSort / Cleanup throws a clear error naming the set.

  ### World.clearAllEntities()

  New public method on `@retro-engine/ecs`. Despawns every live entity,
  drains the removed-component buffer, resets `nextEntityId`. Used by the
  render world's per-frame auto-clear; documented as the canonical reset
  path for ephemeral worlds.

  ### API surface (additive, backwards-compatible)

  - `App.renderWorld: World` — second world instance.
  - `RenderSet` const-namespace + `RenderSetName` type.
  - `AddSystemOptions.set?: RenderSetName`.
  - `Extract<T>(inner: Param<T>): Param<T>` — main-world param wrapper.
  - `World.clearAllEntities(): void`.
  - `ResolveCtx.renderSet?: RenderSetName` (visible to custom param authors).

  ### Known sharp edges (deferred to follow-up ADRs)

  - Cross-world change-detection ticks (`Extract(Query([T], { changed: [T] }))`
    compares main-world rows against a render-world tick).
  - `Commands` targets the main world from any stage; render-stage spawns go
    through `app.renderWorld.spawn(...)` directly.
  - Observers / lifecycle hooks are App-scoped (fire for both worlds).
  - `ExtractResource<T>` / `ExtractComponent<T>` sugar.

  ### ADR provenance

  - Seals ADR-0019.
  - Builds on ADR-0018 (HAL resources, bindings, render targets, milestone A).
  - Resolves the "render-world implementation" open question in
    `docs/roadmap/renderer.md`.
  - Foundation for Phase 2 (cameras + view), Phase 5 (render graph), and
    every subsequent renderer phase.

- 67e8513: feat(engine): resource reflection — authored resources round-trip into scenes (ADR-0069)

  Closes the "resources-as-reflectable" follow-up ADR-0060 reserved. An App-global resource (a settings singleton with no entity identity) can now declare a reflect schema and survive a saved scene, reusing the component codec exactly.

  **New public surface:**

  - `App.registerResource(ctor, schema, opts?)` — mirrors `App.registerComponent`, with a mandatory stable `name`. The owning plugin registers from `build()`. The schema lives in the App's one `TypeRegistry`; `AppTypeRegistry.resources` tracks which registered types are resources, so `@retro-engine/reflect` stays agnostic of the resource concept.
  - `SceneData.resources?: SerializedValue[]` — optional and additive. `SCENE_FORMAT_VERSION` is unchanged: a scene with no resources round-trips byte-identically, and the key is omitted when no registered resource is present. Resolves the "resource definitions in scene files" question — resources travel with the scene.
  - `buildEncodeEnv(world, registry, opts)` — the encode-side mirror of `buildDecodeEnv`, so entities and resources serialize against the same entity-id map (resource `t.entity()` / `t.handle()` fields remap/resolve like a component's).

  **Behaviour:**

  - `serializeScene(app)` now captures registered resources alongside entities; `spawnScene(app, scene)` restores them via `insertResource`, decoded against the same env. The bare-world `serializeWorld` / `deserializeScene` path stays resource-free.
  - Authored world settings register from their owning plugins: `AmbientLight` + `Shadow3dSettings` (Light3dPlugin), `ClearColor` (CameraPlugin), `Light2dSettings` (Light2dPlugin). Derived/transient resources (`Light2dShadowState`, `Light2dNormalState`, `GpuLights`, `Shadow3dState`, `SortedCameras`, `View*` caches, render-graph phase/pipeline/buffer resources, render-world asset caches) are deliberately not registered.

- 836a7ab: feat(engine): retained / change-gated instance preparation (opt-in) — ADR-0039

  After GPU instancing (ADR-0038) the `stress-showcase` "large" preset is 100% CPU/main-thread bound: the sprite and mesh prepare pipelines re-collect, re-sort, re-pack, and re-upload every visible instance each frame even though almost nothing moves. This adds a retained path that keeps instance buffers and sorted draw order across frames and rewrites only what changed — a steady-state frame does O(changed) work instead of O(n).

  New shared instance primitives under `packages/engine/src/instance/`:

  - `RetainedSlotMap` — stable per-entity instance-slot allocator with a length-bucketed free list and compaction.
  - `GrowableInstanceStore` — growable GPU buffer + CPU scratch with dirty-range coalescing and partial uploads (full-upload fallback past 50% dirty).
  - `RetainedInstanceBuffer` — composes the two.
  - `SortedSlotIndex` — retained per-camera draw order that re-sorts only on invalidation (membership / sort-key change / camera move) and copies just the changed bytes when the order is stable.

  Opt-in via a `{ retained }` plugin option (default `false`, so behaviour is unchanged):

  - `new SpritePlugin({ retained: true })` → `RetainedSpriteBuffer` + `prepareSpritesRetained`.
  - `new MaterialPlugin(M, { retained: true })` and `new Material2dPlugin(M, { retained: true })` → `RetainedMeshBuffer` + `prepareMeshRetained`, splitting the per-frame queue into a change-gated prepare and a thin payload-resolving queue.

  Change detection uses a self-managed main-world since-tick (render-stage params carry the render world's tick), mirroring `propagateTransformsGated`. Instance bytes are camera-independent and packed only on `Changed<GlobalTransform>` (plus `Changed<Sprite>` / `Changed<Mesh*>` / `Changed<MeshMaterial*>` for grouping). The path stays WebGL2-reachable — no indirect draw, no storage buffers, no new `RendererCapabilities` flag.

  **New public surface:** `RetainedSpriteBuffer`. The `{ retained }` options on `SpritePlugin`, `MaterialPlugin`, and `Material2dPlugin`.

  **Behaviour changes:** none by default. The retained path is byte-parity with the per-frame path (verified by tests) and is selected only when the option is set.

- ea56975: feat(engine): name rig joints + Unreal-mannequin humanoid aliases

  Makes a spawned rig retarget-ready (RetroHuman Phase 5).

  - `spawnRig` accepts `{ names }` (parallel to joint order) and attaches a `Name`
    to each joint entity, so name-based humanoid retargeting can map the skeleton.
  - The humanoid auto-map (`slotForBoneName`) recognizes Unreal-mannequin /
    MakeHuman `game_engine` bone names (`pelvis`, `neck_01`, `upperarm_*`,
    `lowerarm_*`, `thigh_*`, `calf_*`, `foot_*`, `ball_*`) in addition to the
    existing Synty + Mixamo sets — so the RetroHuman skeleton (and any UE-named
    rig) maps onto the humanoid retarget rig without hand-editing.

  Verified through a full App: a spawned `game_engine`-named skeleton auto-maps all
  22 humanoid slots via `buildHumanoidRetargetRig`.

- 6fbb29d: feat(engine): rig pose + skinned-character spawn for RetroHuman

  Turns a parsed MakeHuman rig into a posable, skinned character (Phase 5).

  - `buildRigPose(rig)` → `RigPose`: per-joint parent index, rest-pose local
    translation (`head - parentHead`), and inverse bind matrix (`inverse(translate(head))`),
    all in joint order so a vertex's `JOINTS_0` index addresses them directly.
  - `spawnRig(world, pose, root?)` → `SpawnedRig`: spawns a joint-entity hierarchy
    (with `Parent`/`Children` edges so transform propagation follows a posed joint
    down its subtree) and returns a `Skeleton` bound to it, ready to attach to the
    mesh entity.
  - `applySkinWeights(mesh, weights)`: attaches `JOINTS_0` / `WEIGHTS_0` vertex
    attributes from parsed `SkinWeights` so the mesh skins through the existing GPU
    skinning path.

  Verified through a full App: posing an ancestor joint deforms a descendant via
  the recomputed skinning palette.

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

- 4015d71: feat(engine): morph-target GPU render path (`MORPHED` pipeline variant)

  The GPU half of runtime morph targets (ADR-0129). A mesh's `MorphWeights` now visibly deform it in
  the vertex shader, on a WebGPU storage-buffer path mirroring GPU skinning.

  - `MorphGpu` (render resource): per-mesh blend-shape delta storage buffer (target-major,
    position+normal, std430), per-entity weights + params buffers, and the `@group(3)` bind group the
    morphed pipeline reads. Gated on `RendererCapabilities.storageBuffers`.
  - `MorphInstanceBuffer` / `makeMorphedDraw`: one draw per morphed entity (morphed meshes are unique,
    not instance-batched), reusing the rigid per-instance transform layout.
  - `packMorphDeltas` / `MORPH_DELTA_FLOATS`: the pure delta packer (benched — cost grows with
    vertices × targets).
  - `MaterialPlugin`: a `material-queue-morphed` queue and a `morphed` pipeline-key variant
    (`#ifdef MORPHED` in `pbr.wgsl` — morph applied before skinning); morphed entities are excluded
    from the rigid queue when storage buffers are available (else they fall back to base geometry).
  - `pbr.wgsl`: `apply_morph` blends per-target weighted position/normal deltas indexed by
    `@builtin(vertex_index)` (minus the mesh's slab base vertex).

  Verified in the studio: a glTF morph target driven 0→1 deforms the live mesh. WebGL2 path and
  prepass participation for morphed meshes are deferred (ADR-0129).

- 82ecdec: feat(engine): saveAsset — serialize one asset to its file + AssetServer.storeForGuid

  `saveAsset(app, guid, kind, location, sink)` serializes a single loaded asset
  through its registered serializer and writes it via the sink at its manifest
  location — the complement of the full `serializeProject` pipeline, for persisting
  one edited asset (e.g. a material changed in the inspector). Returns `false`
  (no-op) when the asset system is absent, the kind has no serializer, or the asset
  is not loaded.

  `AssetServer.storeForGuid(guid)` exposes the store + handle a loaded GUID resolves
  to, so tooling can reach an asset's live value generically — needed because some
  kinds (materials) register their store under a different key than their manifest
  kind. `saveAsset` uses it, falling back to the kind-keyed `AssetStores` registry.

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

- c26f7a3: feat(engine): scene composition — nest scenes inside scenes (ADR-0071)

  A parent scene can now include other scenes as nested entities — the live-link (Godot instanced-scene / Unity nested-prefab) model, the deliberate opposite of ADR-0067's baked template refs. The child stays an independent, editable asset addressed by GUID; saving the parent re-emits the reference, not the child's expanded entities.

  **New public surface:**

  - `SerializedSceneRef` — `{ guid: string }`, a nested child-scene reference.
  - `SerializedEntity.scene?` — an optional ref on any scene entity (the "mount"). Additive and optional, so `SCENE_FORMAT_VERSION` stays `1` and existing scenes round-trip byte-identically.

  **Behaviour:**

  - `spawnScene` turns a `scene` ref into a `SceneRoot` on the mount entity (resolving the child handle via a caller-injected `resolveHandle` or, by default, `AssetServer.loadByGuid`, which also kicks the load). The existing instantiation reactor then expands the child under the mount and re-parents it — so the mount's own `Transform`/`Name`/`Parent` position, name, and nest the instance, and the **same child scene can be instanced many times** (one mount entity each). Nesting recurses, loading lazily one depth-level per frame.
  - The reactor refuses an include cycle (a scene transitively including itself) via a `Parent`-chain ancestor-GUID walk, marking the refused mount with an empty instance instead of spawning unboundedly.
  - `serializeWorld` / `serializeScene` re-emit each mount as its `scene` ref and exclude the child's instantiated entities; a mount whose handle has no GUID is runtime-only (excluded, no ref).

  Per-instance field overrides _inside_ a nested child (Godot "editable children") are deferred to a follow-up.

- 7b8eeea: feat(engine): scene files are YAML with the `.rescene` extension (ADR-0089)

  Scenes now serialize/parse as UTF-8 YAML and load under the `.rescene` extension (was
  `.scene` JSON). The `SceneData` envelope is unchanged — only the text codec and the
  importer's extension key swap, so the payload and validation are identical. JSON is a YAML
  subset, so existing JSON scene fixtures parse unchanged.

  First increment of the on-disk format migration (ADR-0089, superseding ADR-0070): the TOML
  `project.retroengine` descriptor, the `.meta`-sourced generated manifest, and the
  `.reprefab` prefab kind follow in subsequent changes.

- 8a6fb8f: feat(engine): scenes as loadable, state-gated assets — Scene asset, ScenePlugin, SceneRoot reactor, App.addScene lifecycle

  Per ADR-0062. Turns the ADR-0061 `spawnScene` primitive into a usable scene system: a `Scene` becomes a loadable asset with a load/unload lifecycle gated behind a `States` value.

  - **`Scene` asset + `ScenePlugin`** — `class Scene { data: SceneData }`, a `Scenes` store, and a `.scene` JSON importer/serializer (`createSceneImporter` / `createSceneSerializer`) registered by the opt-in `ScenePlugin`. `assetServer.load<Scene>('x.scene')` yields a `Handle<Scene>`.
  - **`SceneRoot` reactor** — a `SceneRoot { handle }` component + an `update`-stage reactor that spawns the scene under the root once the asset is ready and records a `SceneInstance`, mirroring the glTF instantiation precedent (ADR-0057). The scene's top-level entities are re-parented under the `SceneRoot` entity, so despawning the root tears the whole instance down via the hierarchy cascade.
  - **`App.addScene(state, handle, opts?)`** — binds a scene to a `States` value: spawns on `OnEnter(state)`, despawns on `OnExit(state)`. Teardown order is user `OnExit` → scene despawn → state-scoped resource removal.

  Handle resolution stays caller-injected (no automatic GUID→handle resolver yet). Prefab templates/patches, scene composition, inline observer binding, hot-reload, the GUID tier, and registering the remaining components stay deferred.

  No benchmark: scene load (`JSON.parse` + `spawnScene`) and unload (cascade despawn) are one-shot load-time operations; the per-frame propagation they trigger is already benched (CLAUDE.md §11).

- 9712180: feat(engine): screen-space ambient occlusion (GTAO) — ADR-0054

  Per ADR-0054, adds a per-camera `ScreenSpaceAo` component and a pre-opaque ambient-occlusion pass that reads the depth + normal prepass, estimates occlusion with a horizon search, denoises it, and feeds the result back into the lit forward shader's ambient term. AO darkens only the ambient/indirect lighting in creases and contact points — it is not a post-process over the final image, which would wrongly darken direct light.

  The pass chain is `Prepass → AO GTAO → AO blur → AO temporal → Opaque`:

  - **GTAO**, fragment-only (no compute/storage dependency → WebGL2-reachable; a compute speedup is deferred behind a capability flag). Depth + normal are read with `textureLoad` (no sampler), sidestepping depth-format filterability and sampling-uniformity hazards.
  - **Exact reconstruction under TAA jitter.** View-space position is reconstructed by inverting the _jittered_ projection (the matrix the depth was actually rasterized with), computed per AO-enabled camera on the CPU and uploaded in the AO params buffer — the shared view uniform is untouched, so non-AO cameras pay nothing. Resolves the latent reconstruction trap ADR-0053 flagged.
  - **Denoise:** a depth/normal-aware bilateral blur, plus motion-vector-reprojected temporal accumulation (a per-camera history ping-pong with disocclusion rejection) when a `MotionVectorPrepass` is present; otherwise blur-only.
  - **Forward feedback** through a new opaque `@group(3)` AO read binding: lit materials that declare `static usesAo` fork an `aoEnabled` pipeline variant (`#ifdef ENABLE_SSAO`) whose `fs_main` multiplies the sampled occlusion into the ambient term. `OpaquePass3dNode` binds the AO texture for the whole pass; pipelines that don't declare the group ignore it (same contract as the `@group(2)` lights binding). The pipeline key carries a stable `aoEnabled` boolean. This lands the previously deferred opaque `@group(3)` prepass-read binding — carrying the derived AO texture rather than raw prepass channels.

  **New public surface:**

  - `ScreenSpaceAo`, `DEFAULT_AO` — per-camera component (radius, intensity, bias, slices, steps).
  - `AoPlugin` — auto-installed by `CorePlugin`; warns-once-and-skips a camera lacking `DepthPrepass` + `NormalPrepass`.
  - `AoPipeline`, `AoBlurPipeline`, `AoTemporalPipeline`, `AoBindGroupCache`, `ViewAo`, `ViewAoTargets`, the AO nodes/labels, and the `AO_*_WGSL` modules.
  - `MaterialPipelineKey.aoEnabled`, `MaterialCtor.usesAo` (set on `StandardMaterial`).
  - `AO_TARGET_FORMAT` (`r8unorm`), `AO_HISTORY_FORMAT` (`rg16float`), `AO_PARAMS_BYTE_SIZE`.

  **Behaviour changes:**

  - The engine-managed `view-depth` texture is now allocated `RENDER_ATTACHMENT | TEXTURE_BINDING` (was attachment-only) so screen-space passes can sample it. Additive — the depth attachment usage is unchanged.
  - `@retro-engine/renderer-core` `TextureFormat` gains `r8unorm` (single-channel AO target). WebGPU passes it through natively; `bytesPerTexel` returns 1.
  - AO is 3D-only and opt-in; cameras without `ScreenSpaceAo`, and unlit/transparent materials, are unaffected (the non-AO pipeline variant is byte-identical).

  Browser-verified in `apps/playground` (`?mode=ao`, press O to toggle; `&taa=1` to check stability under jitter).

- bc24cd2: feat(engine): screen-space motion vectors — per-entity previous-instance buffer + fs_prepass_motion (ADR-0051)

  Activates the ADR-0050 motion-vector substrate. Cameras carrying `MotionVectorPrepass` now produce a per-pixel `rg16float` screen-space motion-vector target alongside the existing depth and normal targets. Unblocks Phase 12.6 TAA (the first consumer) and the motion-vector half of 12.10 motion blur.

  **New public surface:**

  - `PREVIOUS_INSTANCE_LAYOUT`, `PREVIOUS_INSTANCE_BYTE_SIZE`, `PREVIOUS_INSTANCE_FLOAT_COUNT`, `PREVIOUS_INSTANCE_TRANSFORM_BASE_LOCATION`, `packPreviousInstanceTransform` — per-instance vertex layout + packer for the previous-frame model matrix. Stride 64 bytes, four `float32x4` columns at `@location(16..19)`, `stepMode: 'instance'`.
  - `MeshPreviousInstanceBuffer` — sibling of `MeshInstanceBuffer` carrying the per-entity previous-frame model matrix. Lazily allocated on the first frame a motion-enabled camera asks for it; mirrors the 1.5× growth + deferred-destroy lifecycle.
  - `INSTANCE_LAYOUT`, `MESH_INSTANCE_BYTE_SIZE`, `MESH_INSTANCE_FLOAT_COUNT`, `packInstanceTransform` — promoted from internal to the engine's public surface alongside the new previous-instance peers.
  - `'rg16float'` added to `@retro-engine/renderer-core`'s `TextureFormat` union (additive — the WebGPU backend passes the string through unmodified; existing consumers unaffected). `bytesPerTexel` returns 4.

  **Behaviour changes:**

  - `PREPASS_MOTION_VECTOR_FORMAT` narrows from the `'rgba16float'` placeholder to `'rg16float'` — half the bandwidth of the placeholder.
  - `MotionVectorPrepass` is no longer masked off in `PrepassPlugin`'s Extract — the marker now sets `flags.motionVector` to true alongside `DepthPrepass` and `NormalPrepass`. The one-shot `warnedMotionDeferred` dev-warn is removed.
  - `StandardMaterial.prepassWrites().motionVector` flips from `false` to `true`. `UnlitMaterial` stays depth-only (no normal data, no motion participation).
  - `pbr.wgsl` gains `fs_prepass_motion` (motion-only fragment, single `rg16float` target) and `fs_prepass_normal_motion` (combined normal + motion fragment, two targets in one fragment — keeps cardinality at one prepass pipeline per opt-in material per flag combination). Both entries are conditionally compiled under a new `#ifdef PREPASS_MOTION_VECTOR` define the material plugin sets per-variant.
  - `InstancedDrawPayload` gains an optional `previousInstanceBuffer?: Buffer` field; `makeInstancedDraw` binds it at vertex slot 2 when present. Opaque / transparent / non-motion-prepass payloads leave it undefined.
  - `MaterialPluginState` packs the previous-instance buffer in lockstep with the current-instance buffer when at least one active camera has motion enabled — same iteration order so `firstInstance + count` indexes both buffers identically.

- f45c5f0: feat(engine): screen-space prepass family — depth + normal per-camera (ADR-0050)

  Unlocks Phase 12 effects that need per-camera intermediates available before the opaque pass writes the main color target — SSAO needs depth + normal, DoF needs depth, TAA and motion blur will need motion vectors (substrate in place; per-entity previous-instance plumbing deferred to a follow-on slice).

  **New public surface:**

  - `DepthPrepass`, `NormalPrepass`, `MotionVectorPrepass` — per-camera marker components. Spawning any of them on a camera opts the camera into the screen-space prepass family. `MotionVectorPrepass` is a marker only in this slice; the engine warns once that motion-vector reconstruction lands in a follow-on (`docs/backlog/prepass-motion-vectors.md`).
  - `PreviousGlobalTransform` — per-renderable component carrying last frame's `GlobalTransform.matrix`. Auto-attached by `PrepassPlugin` on any `Mesh3d` insert; advanced each frame at the start of `'first'` so render systems see the correct one-frame lag.
  - `PrepassPlugin` — installs the sub-graph wiring (between `Shadow3dPass3dNode` and `OpaquePass3dNode`), per-camera target allocation, and `PreviousGlobalTransform` propagation.
  - `PrepassNode3d`, `PrepassNode3dLabel` — render-graph node + label.
  - `ViewPrepassTargets`, `ViewPrepassCameraTargets`, `ViewPrepassCacheEntry` — per-camera target cache mirroring the `ViewHdrTargets` / `ViewDepthCache` pattern. Depth is shared with `ViewDepthCache`; normal is `rgba16float`, motion-vector slot is `rg16float` (not allocated until the motion-vector slice lands).
  - `ViewPreviousFrame` — per-camera previous-frame `view_proj` cache (in `camera/extracted.ts`).
  - `PrepassFlagsByCamera` — render-world per-frame flag map populated by `PrepassPlugin`'s Extract.
  - `PrepassFlags`, `PREPASS_FLAGS_NONE`, `prepassFlagsAny`, `intersectPrepassFlags` — flag type + helpers.
  - `PREPASS_DEPTH_FORMAT`, `PREPASS_NORMAL_FORMAT`, `PREPASS_MOTION_VECTOR_FORMAT` — exported format constants.
  - `PREPASS_WGSL` — shared `retro_engine::prepass` shader module (`encode_normal_roughness`, `compute_motion_vector`).
  - `MaterialPipelineKey.prepass?`, `MaterialPipelineKey.prepassReadable?` — additive optional fields on the specialize key (one prepass pipeline per unique flag combination; the readable field is reserved for the opaque pipeline's forward-compat `@group(3)` sampling path landing alongside TAA in `docs/backlog/prepass-readable-binding.md`).
  - `Material.prepassWrites?(): PrepassFlags` — optional opt-in. `StandardMaterial` returns `{ depth: true, normal: true, motionVector: false }`; `UnlitMaterial` returns `{ depth: true }`.

  **Behaviour changes:**

  - `VIEW_UNIFORM_BYTE_SIZE` extends 288 → 352. The new `prev_view_proj: mat4x4<f32>` slot at bytes `288..352` is populated by `prepareCameras` from the `ViewPreviousFrame` cache. Non-prepass shaders ignore the slot.
  - `OpaquePass3dNode` flips `depthLoadOp` from `'clear'` to `'load'` when `ViewPrepassTargets.perCamera` carries an entry for the active camera — the prepass already populated the depth buffer and re-clearing would discard the work. Single behavior change to an existing render node; covered by `prepass-depth-integration.test.ts`.
  - `ViewPhases3d` gains a `prepass: Map<number, PhaseItem3d[]>` field and a `pushPrepass` helper.
  - `StandardMaterial` and `UnlitMaterial` implement `prepassWrites()`. `StandardMaterialPlugin` now registers `retro_engine::prepass` ahead of `retro_engine::pbr` so the import resolves even when the consumer does not add `PrepassPlugin`.
  - Cameras spawned with `depthTarget: 'none'` plus a prepass marker get a one-shot dev-warn and the prepass is silently skipped (the engine never force-allocates depth when the user has explicitly opted out).

- 824b04f: feat(engine): set-level run conditions

  Completes system sets (ECS ordering depth Phase 2b, ADR-0158). `App.configureSet`
  now accepts a `runIf`, gating every member of the set:

  ```ts
  app.addSystem('update', [...], stepAI, { inSet: 'gameplay' });
  app.addSystem('update', [...], stepPhysics, { inSet: 'gameplay' });
  app.configureSet('update', 'gameplay', { runIf: inState(GameState.Playing) });
  ```

  A member runs only when its own `runIf` (if any) **and** every set it belongs to
  pass; multiple conditions on one set are AND-ed. The check runs through a shared
  `setConditionsPass` applied in both the main-stage runner and the render-stage
  runner, so the gate has no half-coverage, and is allocation-free on the hot path.

- 47372a5: feat(engine): shader system — `Shader`, WGSL preprocessor, `PipelineCache`, `SpecializedRenderPipelines` (Renderer Phase 4)

  Per ADR-0022, every `App` now runs a shader-and-pipeline dedupe layer above the HAL, plus a minimal WGSL preprocessor with `#import` / `#define` / `#ifdef`. The HAL itself (`renderer-core`, `renderer-webgpu`) is untouched.

  **Shader authoring (`packages/engine/src/shader/`):**

  - `Shader` — value class wrapping raw WGSL source plus an optional label. Asset-handle later (waits for the asset system); raw-source today.
  - `ShaderRegistry` — App resource mapping module names (Bevy-style `crate::module`, e.g. `retro_engine::view`) to raw WGSL. Inserted by `ShaderPlugin`; `CameraPlugin.build` pre-registers `retro_engine::view` so user shaders read `VIEW_UNIFORM_WGSL` via `#import retro_engine::view` instead of copy-pasting the snippet.
  - `preprocessWgsl(source, registry, options?)` — pure WGSL → WGSL transform.
    - `#import <module_name>` inlines the registry's source. Single-include per top-level compile; cycles throw with the chain.
    - `#define NAME [value]` seeds a token-aware substitution table. External `options.defines` merge first; in-source `#define` may shadow. `false` external values are treated as not-defined; `true` is defined-with-empty-replacement.
    - `#ifdef NAME` / `#ifndef NAME` / `#else` / `#endif` are line-based, nestable; `#define` / `#import` inside an inactive branch are dropped.

  **Pipeline dedup (`packages/engine/src/shader/`):**

  - `PipelineCache` — App resource. `compileShader(shader, defines?)` preprocesses and hashes the WGSL, returning the cached `ShaderModule` on a hit. `getOrCreateRenderPipeline(descriptor)` hashes a structural digest (shader source hash, entry points, color formats, primitive topology, `PipelineLayout` identity) and shares the compiled pipeline across identical descriptors. Label is not part of the key.
  - `SpecializedRenderPipelines<Key>` — user-instantiated per pipeline family. Constructor takes the shared `PipelineCache`, a `specialize: (Key) => RenderPipelineDescriptor` callback, and an optional `keyToString` (default `JSON.stringify`). `get(key)` builds the descriptor once per distinct key string and routes it through the cache; two keys that produce structurally-identical descriptors share a pipeline via the cache's descriptor hash.

  **Engine wiring:**

  - `ShaderPlugin` is auto-installed by `CorePlugin` immediately before `CameraPlugin`. It inserts both resources; `CameraPlugin.build` then registers `retro_engine::view`.
  - The playground triangle is retrofitted to drive the full chain: `Shader` → `PipelineCache.compileShader` → `SpecializedRenderPipelines.get` → `PipelineCache.getOrCreateRenderPipeline`. Same pixels, no visual change — the retrofit is the manual smoke witness.

  **Behaviour notes / explicit non-scope:**

  - `renderer-core` / `renderer-webgpu` are not edited. The HAL boundary at `Renderer.createShaderModule(code: string)` is the right seam — when the WebGL2 backend lands, WGSL → GLSL ES translation happens inside that backend, not in the engine. The preprocessor is named `preprocessWgsl` for what it is.
  - `ShaderRef` (`Default | Path | Handle`) and hot reload are deferred until the asset system lands.
  - Richer preprocessor syntax (`#import ... as alias`, selective imports, `#if <expr>`, function-like macros, recursive define expansion) is not in MVP — none has a consumer in Phase 4–6.
  - The `@group(0) = view` convention enforcement / auto-bind stays on its backlog item (Phase 7). Phase 4 makes the convention easier to adopt — user shaders no longer copy-paste the snippet — but does not pin a group index.
  - Both caches grow without pruning today. Eviction lands with the asset system, which also drives hot-reload invalidation.

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

- 88c4629: feat(engine): skeletal-animation Phase 2 — pose pipeline + animation controller

  Per ADR-0118 and ADR-0119, animation no longer samples straight into `Transform`. A clip now
  samples into a **`Pose`** (per-bone local TRS), poses **blend**, and the blended result is
  committed to bone `Transform`s **exactly once** per frame — the architectural hinge the rest of
  the Unity-like stack (layers/masks, IK, retargeting) builds on. Phase 1's general property
  animation is unchanged: only whole-field bone `Transform` tracks route through the pose; every
  other track still writes directly.

  **Pose pipeline** (`pose.ts`, `pose-blend.ts`):

  - `Pose` — per-bone TRS as SoA `Float32Array`s, addressed by slot, held in the transient
    `AnimationPoses` resource (not a component, not serialized). Doubles as the blend accumulator
    with per-field per-slot weights, so a clip that drives only some bones (or only a rotation)
    leaves the rest at their authored values.
  - Sign-aligned accumulated nlerp for rotations (`accumulateRotation`/`finalizePose`), weighted
    average for translation/scale; `samplePoseFromClip` and `commitPoseToTransforms`.
  - The evaluation system (`animation-system.ts`) routes both `AnimationPlayer` and the new
    controller through the pose, commits once in the `update` stage (before `postUpdate`
    propagation → skinning), and keeps the non-bone direct-write path.

  **Animation controller** (`animation-controller.ts`, `state-machine.ts`, `blend-tree.ts`) — a
  Unity-Animator-Controller-shaped asset (`.ranimctrl`) unifying Bevy's blend graph with a state
  machine:

  - `AnimationController` asset: parameters (`float`/`bool`/`trigger`), states (clip or blend-tree
    motion), and condition/trigger transitions with crossfade `duration` + optional exit time.
  - Blend trees: 1D linear plus all three Unity 2D modes (`simpleDirectional`, `freeformCartesian`,
    `freeformDirectional`).
  - `AnimationControllerPlayer` component (authored `controller`/`speed`/`playing`/`parameters`,
    schema-registered) + transient `AnimationControllerRuntimes` resource (active state, crossfade
    progress, per-state phase). The transition weight-ramp is the crossfade.

  Adds a `pose-blend` bench (cost grows with bones × sources).

- 93f4053: feat(engine): skeletal-animation Phase 3 — animation layers + avatar masks

  Per ADR-0120, a rig can play several animations at once, each scoped to part of the body and
  combined by replacement or by adding a delta — Unity-style layers, masks, and additive blending.
  Pure pose math on top of the Phase-2 pipeline (ADR-0118): no new GPU work beyond Phase 0. The
  existing `AnimationPlayer` and `AnimationControllerPlayer` paths are untouched and drive entities
  that don't opt into layers.

  **`AvatarMask` asset** (`avatar-mask.ts`, `avatar-mask-asset.ts`) — a reusable, shareable
  `.ramask` asset (via the asset-kind flow): a **binary** include set of bone target ids, keyed on
  the same `AnimationTarget.id` clips bind through. A layer with a mask contributes only to the
  bones in the set; masked-out bones keep the lower layers' value. This is the generic/Transform
  mask; the Unity humanoid body-part toggle is deferred to Phase 5 (it needs the canonical humanoid
  avatar). The studio mask-authoring UI is out of scope — masks are driven via code/MCP for now.

  **`AnimationLayers` component** (`animation-layers.ts`) — an ordered layer stack (bottom/base
  first). Each layer carries a `weight`, a blend mode (`override` | `additive`), an optional `mask`
  handle, and a motion `source` that is **either a clip or a full `AnimationController`** (so a
  bare-clip layer stays cheap, and a layer can host its own state machine). Transient per-layer
  playback (clip cursor, controller state) lives in the `AnimationLayerRuntimes` resource; the
  additive reference (bind) pose lives in the `ReferencePoses` resource — both derived, never
  serialized.

  **Layer composition** (`layer-blend.ts`, `animation-system.ts`) — the layered driver builds one
  shared slot layout across every bone any layer animates, evaluates each layer bottom-up into a
  pose with the Phase-2 machinery, then composes into a single accumulator gated per bone by the
  layer's mask, and commits once:

  - `composeLayerOverride` — `lerp(below, layer, weight)` (sign-aligned nlerp for rotation) on
    masked bones; the base layer onto an empty accumulator is the same operation.
  - `composeLayerAdditive` — adds the delta from the **glTF bind pose** (`t += w·Δt`,
    `r = base · nlerp(identity, ref⁻¹·clip, w)`, `s *= lerp(1, clip/ref, w)`), captured lazily from
    each bone's rest `Transform`.

  Adds a `layer-blend` bench (cost grows with bones × layers).

- ba77627: feat(engine): skeletal-animation Phase 4 — inverse kinematics

  Per ADR-0121, IK constraints correct the posed skeleton as a post-pass — a foot plants, a hand
  reaches a target, a head aims — on top of whatever the animation/layer stack produced. Pure
  transform math: no new GPU work beyond Phase 0. The IK solve runs in `postUpdate`
  `{ after: ['transform-propagation'], before: ['skinning-compute-palettes'] }`, so it reads valid
  world transforms and the corrected pose reaches the skinning palette the same frame.

  **Solvers** (`animation/ik/two-bone.ts`, `ccd.ts`, `look-at.ts`) — pure, ECS-free:

  - `solveTwoBone` — analytic law-of-cosines limb solver (shoulder/elbow/hand, hip/knee/ankle) with a
    pole hint for the bend plane and reach clamping into the triangle-solvable range.
  - `solveCcd` — Cyclic Coordinate Descent for N-bone chains (spine, tail). CCD over FABRIK because the
    skeleton is a rotation hierarchy — CCD outputs joint rotations directly; FABRIK is backlogged.
  - `solveAim` — look-at/aim: point a bone's local aim axis at the target, roll about it so an up axis
    aligns with a world-up reference.

  **Constraint components** (`animation/ik/ik-constraints.ts`) — `TwoBoneIK`, `IkChain`,
  `LookAtConstraint`, each a reflected, schema-registered component (round-trips through scenes,
  survives hot reload). Target and pole are nullable **entity** references (parentable/animatable; a
  `null` pole keeps the FK bend). A per-constraint `weight` (0..1) blends the IK result over the FK
  pose via slerp; `TwoBoneIK.targetRotationWeight` orients the tip to a planted foot/hand. Multiple
  constraints on a rig solve in ascending `order`.

  **System + re-propagation** (`animation/ik/ik-system.ts`, `hierarchy.ts`) — `addIkSolve` reads each
  bone's world transform, solves, writes the weighted local rotation, and re-propagates just the
  affected chain in place via the new `recomputeWorldSubtree(world, chainRoot)` helper (the frame's
  gated propagation has already run and will not run again). `IkPlugin` registers the components and
  the system; `CorePlugin` adds it after `AnimationPlugin`.

  The entity-reference target + per-constraint weight are the contact-pinning seam Phase 5
  (retargeting) reuses. The broader IK/constraint space (FABRIK backend, Full-Body IK, Spline IK,
  per-joint limits, foot grounding, the procedural rig-constraint family) is backlogged. Adds an
  `ik-solve` bench (two-bone, look-at, CCD across bones × iterations).

- f2f082b: feat(engine): skeletal-animation Phase 5 — animation retargeting

  Per ADR-0122, a clip authored for one skeleton plays on a differently-proportioned one — take a
  GLB's animation and use it on another character. Retargeting is a **clip-production** step, not a
  per-frame component: it bakes a source clip into an ordinary native `AnimationClip` for the
  target, the way Unity (humanoid bake) and Unreal ("Export Retargeted Animations") do. So the
  output flows through the existing `AnimationPlayer` / `AnimationController` / blend trees /
  `AnimationLayers` and the Phase-4 IK post-pass with no special handling — N clips from M source
  rigs become N first-class clips on a character. No new authored component, no new per-frame
  system, no GPU work beyond Phase 0.

  **`RetargetRig` asset** (`retarget-rig.ts`, `retarget-rig-asset.ts`, `retarget-reference-pose.ts`)
  — a skeleton's rig description (kind `RetargetRig`, `.rerig`): each canonical `HumanoidSlot` → a
  bone (clip-binding id) + that bone's rest pose (local TRS, rest **world** rotation) and its
  **reference-pose** world rotation. The analogue of a Unity Avatar / Unreal IK Rig; carries no
  entity references, so it is shareable and serializable. `buildHumanoidRetargetRig(world,
skeletonRoot, name?, opts?)` auto-maps a live skeleton by bone name (Unity "Configure Avatar"
  auto-detect, covering Synty and Mixamo naming), captures the rest pose by forward kinematics
  relative to `skeletonRoot`, and derives each bone's reference-pose rotation from the bind **bone
  directions** (`bone → child` world vectors — position-based, so immune to per-bone axis re-roll and
  container rotations). `opts.referencePose` authors that pose by hand per slot (the Unreal "retarget
  pose" escape hatch).

  **`retargetClip`** (`retarget-clip.ts`, `retarget-transfer.ts`) — `retargetClip(source,
sourceRig, targetRig, opts)` returns a new clip addressing the target's bones. Bone rotations
  transfer as a **deviation from a shared reference pose** both rigs are posed into — a canonical
  T-pose — rather than from each rig's own bind (`A · srcLocal · B`, constant factors per bone). So a
  clip authored on an A-pose animation pack lands correctly on a T-pose target: at the source's rest
  the target shows the source's rest _shape_, not its own bind — idle rests naturally, no T-pose, no
  wrist flip (per ADR-0125). Hip/root translation is re-based into the target's root frame and scaled
  by the rigs' height ratio (`animationScaled`) or dropped (`targetBindPose`); other bones'
  translation and all scale tracks are dropped so the target keeps its own bone lengths. Residual
  contact drift is corrected at runtime by the target rig's own foot/hand `TwoBoneIK` constraints
  (ADR-0121). The `RetargetRig` carries reference-pose world rotations per slot (`.rerig` format v3).

  **Humanoid profile + helpers** (`humanoid.ts`, `humanoid-mask.ts`, `bind-retarget-rig.ts`) — the
  canonical `HumanoidSlot` set, `HUMANOID_BODY_PARTS`, and bone-name auto-map table.
  `humanoidBodyPartMask(rig, parts)` builds an `AvatarMask` from canonical body parts
  (head / arms / legs / torso) — resolving the humanoid body-part mask deferred from Phase 3.
  `bindRetargetRig` tags a target skeleton's bones with `AnimationTarget`s so a retargeted clip
  binds through the normal player.

  `RetargetPlugin` registers the `.rerig` asset kind (added by `CorePlugin` after `IkPlugin`). Adds
  a `retarget` bench (cost grows with bones × keyframes).

- 641b263: feat(engine): skinned + morphed pipeline variant

  A mesh that is both skinned and morphed (a character with facial blend shapes) now deforms by both —
  morph applied to the rest pose, then skinned — completing the runtime morph-target feature (ADR-0129).

  - `pbr.wgsl`: when compiled with both `SKINNED` and `MORPHED`, the joint palette keeps `@group(3)`
    binding 0 and morph deltas/weights/params shift to 1/2/3 (binding numbers selected by `#define`, no
    collision). `apply_morph` already runs before `skin_matrix`.
  - `MorphGpu`: a combined `@group(3)` layout (palette + morph) and `prepareEntity(..., paletteBuffer)`
    builds a per-entity bind group referencing the shared joint palette plus the mesh's morph data.
  - `MaterialPlugin`: the skinned queue routes a `Skeleton`-bearing entity that also has `MorphWeights`
    to a `skinned: true, morphed: true` pipeline variant, binding the combined group and emitting one
    draw per such entity (it can't share an instanced batch). Skinned-only entities still batch.

  Verified in the studio: a skinned cube with an "inflate" morph target both skins and visibly inflates
  when its weight is driven 0→1. (`MorphGpu` no longer eagerly frees per-entity buffers on despawn —
  the morph-only and combined queues share one entity map; tracked as a deferred cleanup.)

- 7812b83: feat(engine): skybox + image-based lighting from a cube environment

  Per ADR-0105, lands the cube-sourced half of the environment-map system — a
  visible **skybox** (roadmap Phase 12.7) and **image-based lighting** (Phase 10.7)
  that share one `Handle<Image>`. The flat ambient term from ADR-0044 is replaced
  by environment lighting whenever an `EnvironmentMapLight` is active. Both are
  device-verified in `apps/playground` (`?mode=skybox`, `?mode=ibl`). No new HAL,
  no new capability flag — the IBL prefilter is render-pass based (WebGL2-reachable),
  not compute.

  **New public surface:**

  - `Skybox` — per-camera component (`image: Handle<Image>` cube, `brightness`,
    `rotation`). Serialized.
  - `SkyboxPlugin({ shaderModule? })` — opt-in; inserts a fullscreen-triangle
    `ViewNode` into Core3d between the opaque and transparent passes, depth-tested
    so geometry occludes the sky, writing HDR into the camera's main target. The
    fragment shader is resolved by registered module name, so a custom/procedural
    sky is a drop-in replacement.
  - `SkyboxPipeline`, `ViewSkybox`, `makeSkyboxNode` / `SkyboxPass3dLabel`,
    `SKYBOX_WGSL`.
  - `EnvironmentMapLight` — per-camera component (`environmentMap: Handle<Image>`
    cube, `intensity`, `diffuseIntensity`, `specularIntensity`, `rotation`).
    Serialized.
  - `EnvironmentMapPlugin` — opt-in; requires `Light3dPlugin`. Runtime-prefilters
    the source cube (diffuse irradiance + GGX specular mip chain; the BRDF LUT is
    baked once globally) and feeds the split-sum result into the PBR ambient term.
  - `EnvironmentPrefilter`, `RenderEnvironmentMaps`, `ActiveEnvironment`,
    `ENVIRONMENT_PREFILTER_WGSL`, `PrefilteredEnvironment`.
  - `ENVIRONMENT_PARAMS_BYTE_SIZE` / `ENVIRONMENT_PARAMS_FLOAT_COUNT`.

  **Behaviour changes:**

  - The `GpuLights` `@group(2)` bind group grew from 3 bindings to 8: the existing
    lights uniform + shadow atlas + comparison sampler, plus the IBL set —
    irradiance cube (3), specular cube (4), BRDF LUT (5), environment sampler (6),
    and an environment-params uniform (7). The set is always bound (1×1 fallbacks +
    a `has_environment` flag), so lit pipelines pick it up transparently and take
    the flat-ambient path when no environment is active. The `GpuLights` _uniform_
    byte layout is unchanged (8128 B).
  - `pbr.wgsl` `fs_main` branches its indirect term: split-sum IBL when an
    environment is bound, otherwise the previous flat `lights.ambient`. Every lit
    material gets IBL automatically — there is no per-material opt-out.

  HDRI (`.hdr`) loading + equirectangular→cube conversion (so a `.hdr` can be the
  source) is the remaining Phase 10.7 work and lands separately.

- f0584f2: feat(engine): sprite definition model + resolver

  Sprite definitions Phase A. `SpriteDefinition` is the serializable `.meta` shape a
  Sprite Editor authors — `mode` (single/multiple), a `grid` or `rects` slicing
  `source`, `ppu`, and per-slice `slices` (pivot / border / name).
  `resolveSpriteDefinition(def)` turns it into `{ layout, sprites }`: it builds a
  `TextureAtlasLayout` via `fromGrid` / `fromRects`, computes each slice's pixel
  size (so `customSize = pixelSize / ppu`), and applies per-slice pivot / border /
  name (defaults: `center` pivot, `DEFAULT_PPU` = 100, index as name).

  Pure and unit-tested. Minting each slice as an addressable sub-asset (composite
  GUID) and the Sprite Editor UI are tracked follow-ups.

- bc634ae: feat(engine): Sprite component + SpritePipeline + Core2d phase trio

  Phase 8.1 lands the batched sprite pipeline — the 2D twin of Phase 7's `Mesh3d + MaterialPlugin` slice. Per ADR-0031. Cameras spawned via `Camera2d()` now drive an `Opaque2dNode → Transparent2dNode` phase trio (replacing the Phase 7 `MainPassNode` shim), and a new `SpritePlugin` pushes one instanced draw per `(ImageHandle, alphaBucket)` batch into `ViewPhases2d`.

  **New public surface:**

  - `Sprite` — ECS component carrying `{ image: ImageHandle | undefined; color: Vec4; customSize?: Vec2; rect?: Rect; anchor: SpriteAnchor; flipX: boolean; flipY: boolean }`. `image: undefined` resolves to `Images.WHITE` at queue time, so `new Sprite({ color, customSize })` is a usable solid-tint quad with no image plumbing. Required components: `Transform`, `GlobalTransform`, `Visibility`, `InheritedVisibility`, `ViewVisibility`.
  - `SpriteAnchor` — `'center' | 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight' | { x: number; y: number }`. Bevy parity: 0..1 within the sprite's footprint.
  - `Rect` — `{ min: Vec2; max: Vec2 }` value class. Used as a render-from sub-rect of the source image; forward-compatible with the Phase 8.2 `TextureAtlas` asset.
  - `SpritePlugin` — engine plugin owning the built-in batched pipeline. Registers `retro_engine::sprite` WGSL, inserts the pipeline + instance-buffer resources, registers prepare + queue systems.
  - `SpritePipeline` — render-world resource holding the shared quad VBO/IBO, the `SpecializedRenderPipelines<SpriteKey>`, and the per-image `BindGroup` cache. Exposed for downstream introspection and for tests.
  - `SpriteInstanceBuffer` — render-world resource owning the growable per-frame instance VBO + scratch.
  - `SpritePreparedBatches`, `SpriteBatch`, `SpriteKey`, `SpriteAlphaBucket`, `SpriteOptions`, `SpriteSpecializeContext` — supporting types for plugins that consume or replace pieces of the pipeline.
  - `packSpriteInstance`, `SPRITE_INSTANCE_BYTE_SIZE`, `SPRITE_INSTANCE_FLOAT_COUNT`, `resolveAnchor` — pack-path helpers exposed for benches and downstream tooling.
  - `SPRITE_WGSL` — the registered shader source.
  - `PhaseItem2d` interface + `ViewPhases2d` render-world resource — the 2D twin of `PhaseItem3d` / `ViewPhases3d`. Maps keyed by main-world camera entity id; `pushOpaque` / `pushAlphaMask` / `pushTransparent` / `clear` methods mirror the 3D shape.
  - `OpaquePass2dNode`, `OpaquePass2dLabel`, `TransparentPass2dNode`, `TransparentPass2dLabel` — new render-graph nodes that drain `ViewPhases2d`.
  - `makeCapturingRenderer` — test-utility renderer that records every `RenderPassEncoder` interaction, surfacing a `CapturedDrawLog` so tests can assert how many draws ran with which bind groups.
  - `attachLegacyMainPassToCore2d` — test-utility helper to re-attach `MainPassNode` to the Core2d sub-graph for tests exercising the legacy `RenderSet.Render` + `RenderCtx` path.

  **Breaking changes:**

  - `buildCore2dSubGraph()` no longer registers `MainPassNode`. Cameras with `subGraph: Core2dLabel` now run `OpaquePass2dNode → TransparentPass2dNode` instead. User code that depended on the implicit `RenderSet.Render` open-pass behaviour (a registered render-stage system with no explicit `set`) sees the system invoked outside any open render pass, so `RenderCtx`-based draws silently no-op. Migrate to either pushing a `PhaseItem2d` into `ViewPhases2d` from a `RenderSet.Queue` system or to a custom sub-graph that adds `MainPassNode` manually (the symbol remains exported).

- f95bac1: feat(engine): TextureSlicer — 9-slice sprites via SpriteImageMode

  Phase 8.5 adds 9-slice rendering on top of the existing sprite hot path. Per ADR-0034. A new optional `imageMode` field on `Sprite` toggles the renderer between the historical single-quad path (default) and a new 9-quad path: four corner quads stay at the border's pixel size in destination units while the four edges and centre stretch to fill `customSize`. Drop-in stretchable UI panels — dialog boxes, health bars, scroll backgrounds — without re-authoring images per size.

  The slicer composes with the rest of the 2D data path automatically. An atlassed sprite can be sliced (the border carves inside `sprite.rect`'s per-frame UV sub-rect, not the full image). An animated sprite can be sliced (the animator ticks `atlas.index` → atlas-sync writes `sprite.rect` → the slice packer reads the new rect). A parented sprite can be sliced (the per-instance affine basis handles non-uniform scale and rotation correctly across all nine quads). No new plugins, no new resources — `SpritePlugin`'s system registration is unchanged.

  **New public surface:**

  - `BorderRect` — value class. `{ left, right, top, bottom }` in **source-image pixels** (Y-up convention matching `SpriteAnchor` — `top` = the higher-Y edge of the source rectangle). Four-arg constructor for asymmetric borders; static `BorderRect.all(px)` factory for symmetric panels.
  - `TextureSlicer` — data class describing a 9-slice carving. Options-bag constructor: `{ border: BorderRect; centerScaleMode?: SliceScaleMode; sidesScaleMode?: SliceScaleMode; maxCornerScale?: number }`. Both scale modes default to `'stretch'`. Only `'stretch'` ships in this phase; `'tile'` and `maxCornerScale` enforcement are forward-compat seams documented under "Not yet done" in ADR-0034.
  - `TextureSlicerOptions` — input shape for the constructor.
  - `SliceScaleMode` — `'stretch'` (single-variant union; expands when tile mode lands).
  - `SpriteImageMode` — discriminated union `{ kind: 'auto' } | { kind: 'sliced'; slicer: TextureSlicer }`. Stored on `Sprite` as the new optional `imageMode` field.

  **`Sprite` constructor delta:**

  - `SpriteOptions.imageMode?: SpriteImageMode` — new optional field. Default (`undefined`) renders as a single quad — every existing call site is unaffected. Pass `{ kind: 'sliced', slicer }` to opt into 9-slice rendering:

    ```ts
    cmd.spawn(
      new Sprite({
        image: panelImage,
        customSize: vec2.create(320, 160),
        imageMode: {
          kind: 'sliced',
          slicer: new TextureSlicer({ border: BorderRect.all(8) }),
        },
      }),
      new Transform(...),
    );
    ```

  **Behaviour changes (non-breaking):**

  - `packSpriteInstance` is now a router. For sprites without `imageMode` (or with `{ kind: 'auto' }`), the packed output is byte-identical to the previous behaviour. For `{ kind: 'sliced', slicer }`, the function emits nine packed instances in fixed `BL → BM → BR → ML → MM → MR → TL → TM → TR` order and returns `9 × SPRITE_INSTANCE_FLOAT_COUNT`. Callers that step a cursor via the return value (the standard pattern) are unaffected.
  - The sprite prepare loop's instance-count is now `consumed / SPRITE_INSTANCE_FLOAT_COUNT` per entity instead of `+ 1`. The instance buffer's growth target accounts for sliced entities contributing 9 each. Batches still key on `(image, alphaBucket)` and a sliced sprite contributes 9 contiguous instances to its batch.

- 7dddd6f: feat(engine): Z-aware sprite batching — sort-then-walk prepare path honours per-sprite Z

  Phase 8.8 closes the within-batch ordering gap exposed by Phase 8.7's back-to-front Core2d sort flip. Per ADR-0036. The sprite prepare step now sorts visible sprites by `(alphaBucket, -worldZ, imageHandle)` before walking the sorted list once and emitting a new `SpriteBatch` whenever consecutive entries differ on `(imageHandle, alphaBucket)`. Same-image sprites at varying Z collapse to one batch with per-instance order back-to-front (best case); a foreign-image sprite at an intermediate Z breaks the run automatically and the result is three correct batches in painter order (worst case: one sprite per batch when every Z transition swaps image). The map-based grouping that captured "the first sprite's Z" as the batch sort key is gone.

  Same-image parallax for opaque content now composites correctly without forcing `alphaMode: 'blend'` on every layer. Together with the Phase 8.7 sort flip the Core2d painter pipeline is complete for both cross-batch and within-batch ordering across all three phases (`Opaque2d`, `AlphaMask2d`, `Transparent2d`).

  **Behaviour changes (non-breaking):**

  - `SpriteBatch.worldZ` redefined from "world-space Z of the batch's first sprite" to "maximum `worldZ` across the batch's sprites" (= first packed instance's Z after the back-to-front sort). Internal type — no consumer impact. Wording chosen so the semantics hold under flipped or rotated 2D cameras; per-camera direction continues to come from the view matrix's `v[10]`.
  - Sprite batch identity is no longer stable across frames — float drift on `worldZ` can shuffle same-Z batch boundaries. Nothing downstream interns batch references; the bind-group cache is image-keyed.

  **New internal surface (not re-exported from the engine package):**

  - `packages/engine/src/sprite/sprite-batch-prepare.ts` — `sortAndEmitSpriteBatches(entries, images, scratchF32, scratchU32, out)` pure function, plus `PerSpriteEntry` / `SpriteImageSizeLookup` types and the `instanceCountForSprite` helper. Bench harness uses it directly without booting an App.

- a0fb8d4: feat(engine): StandardMaterial normalScale + doubleSided

  Extends the shipped `StandardMaterial` and `pbr.wgsl` with two core PBR controls so models render
  correctly without manual shader work.

  - **`normalScale`** (default `1`) — normal-map intensity (glTF `normalTexture.scale` semantics).
    `pbr.wgsl` now applies the normal map: it reconstructs a tangent frame from screen-space derivatives
    (no per-vertex tangent attribute required) and scales the sampled tangent-space normal's X/Y by
    `normalScale` before transforming it to world space. With no normal map bound the flat-normal
    fallback is a no-op, so plain materials are unchanged.
  - **`doubleSided`** (default `false`) — when `true`, the material's pipeline disables back-face culling
    (cull mode `none` instead of `back`) and the shader flips the shading normal on back faces, so
    single-sided surfaces such as foliage, cards, and glass shade correctly from both sides.

  Both fields are additive — no breaking change. `Material` gains an optional `doubleSided(): boolean`
  alongside the existing `alphaMode()` / `depthBias()`; single- and double-sided variants of a material
  get distinct cached pipelines.

- 59d37c2: feat(engine): explicit ordering for state-transition systems

  ECS ordering depth Phase 5a (ADR-0161). `onEnter` / `onExit` / `onTransition` now
  accept `label` / `before` / `after` (a new `StateSystemOptions`), so transition
  systems in the same phase can be ordered independently of registration order:

  ```ts
  app.onEnter(GameState.Playing, [...], spawnPlayer, { label: 'spawn' });
  app.onEnter(GameState.Playing, [...], focusCamera, { after: ['spawn'] });
  ```

  They're ordered by the same topological sort as the main schedule (now generic
  over both stage systems and transition records), with the same eager cycle
  detection — a cycle throws at the `onEnter`/`onExit`/`onTransition` call site.
  Purely additive: a transition system with no ordering options keeps its
  registration-order behavior.

- acae153: feat: sub-asset references + derived-asset asset browser

  Per ADR-0126, gives a container's decoded children (a model's meshes, materials, and animation clips) a persistent, resolvable identity so a saved reference to one survives reload — and surfaces them in the studio's rebuilt asset browser.

  **`@retro-engine/assets`** — `subAssetGuid(parent, label)` / `parseSubAssetGuid(guid)`: the composite GUID-URI (`"<parentGuid>#<label>"`) that names a labeled sub-asset deterministically from its container's GUID. A single string, so it serializes and resolves exactly like a top-level GUID.

  **`@retro-engine/engine`** — `AssetServer.registerSubAssetStore(prefix, store)` binds a label prefix to the store that holds those sub-assets; `loadByGuid` now resolves a sub-asset reference by reserving the slot and loading the parent so its `addLabeledAsset` fills it (matched by GUID), and `hasGuid` recognizes sub-refs whose container is resolvable. `addLabeledAsset` mints the deterministic sub-GUID when a parent GUID is present. The glTF `AnimationPlugin` registers the `Animation` prefix, so a model's clips are assignable to a `Handle<AnimationClip>` field and round-trip through scene save/load. `subAssetGuid` / `parseSubAssetGuid` are re-exported.

  **`@retro-engine/editor-sdk`** — `assetCard` returns `AssetCardResult` (`{ clicked, expandToggled, checkToggled, rightClicked }`) and takes an `onContextMenu` hook anchored to the tile; its error preview uses the triangle-alert glyph and sprites get a dashed cyan crop frame; the fold chip moved to the top-right to clear the type tag. `assetGroup` is generalized from sprite-only to any source file's mixed children: it takes `headerType` (drives the icon/tone) and a `summary` string instead of a sprite count, and draws the inset accent rail.

- 8934a75: System param protocol: `App.addSystem` now takes a tuple of param tokens plus a value-receiving function, with optional `runIf` run condition. Sealed as ADR-0006.

  - `packages/engine` exports `Param`, `ResolveCtx`, `SystemId`, `RenderCtx`, `Res`, `RunCondition`, `ParamValues`. Phase 1 ships `RenderCtx` (stage-scoped to `'render'`) and `Res(ctor)` against a minimal resource registry on `App` (`insertResource`, `getResource`).
  - `SystemFn` and `RenderSystemFn` types removed; the old `addSystem` overload pair is replaced by one signature: `addSystem(stage, params, fn, options?)`.
  - `packages/ecs` removes the unused `System` type alias.

  Migration: `addSystem('startup', () => {...})` → `addSystem('startup', [], () => {...})`. `addSystem('render', (world, ctx) => {...})` → `addSystem('render', [RenderCtx], (ctx) => {...})`.

- f55bffb: feat(engine): named system sets + set-level ordering

  Second slice of ECS ordering depth (ADR-0158). Systems can join reusable, named
  sets, and a set's ordering is configured once for the whole group:

  ```ts
  app.addSystem("update", [ResMut(Velocity)], integrate, { inSet: "physics" });
  app.addSystem("update", [Res(Velocity)], resolveContacts, {
    inSet: "physics",
  });
  app.configureSet("update", "physics", { after: ["input"] }); // both run after input
  ```

  - `AddSystemOptions.inSet` — a string or string[]; a system can join several sets
    and still carry its own `label`.
  - `App.configureSet(stage, set, { before, after })` — set-level ordering expanded
    onto every member; repeated calls merge; cycles are caught eagerly and rolled
    back.
  - The topo sort now indexes each system by its `label` **and** its set
    memberships under one name map, so a per-system `before` / `after` target
    matches a set name as well as a label (backward-compatible superset).
  - `SystemInfo.sets` surfaces membership in `describeSchedule` for tooling.

  Ordering-only and entirely at registration time — no per-frame cost. Set-level
  `runIf` is a tracked follow-up.

- b1a1e01: feat(engine): Phase 12.6 — temporal anti-aliasing (`Taa`)

  Per ADR-0053, adds a per-camera `Taa` component and an HDR-space resolve that jitters the camera a sub-pixel amount each frame and blends the current frame against a reprojected accumulation of previous frames — near-supersampled edges for a fraction of the cost. It is the second HDR post pass after motion blur and runs `Transparent → TAA → MotionBlur → Tonemapping`. Like motion blur it requires `Camera.hdr = true` and a `MotionVectorPrepass`; when either is missing it warns once and the camera renders without TAA rather than failing. No new HAL, no new capability flag.

  Jitter is baked into the shared `view_proj` on the CPU so the depth prepass and the main pass rasterize identical geometry (a main-pass-only jitter would be rejected against the un-jittered depth buffer at silhouettes). Motion vectors stay jitter-free by reading a new `unjittered_view_proj` field. The resolve reprojects history along the motion target, clips it into the current 3×3 neighborhood's YCoCg variance box (no ghosting), and blends with Karis tonemap weighting (no HDR firefly trails).

  This release also refactors the HDR post-process chain onto a shared `CurrentHdrView` handoff resource: each pass reads the latest scene view and stores its own output back, replacing the per-pass hardcoded lookups (MotionBlur and Tonemapping were moved onto it). Behaviour is unchanged for existing scenes.

  **New public surface:**

  - `Taa` (+ `DEFAULT_TAA`) — per-camera component with a `blend` weight.
  - `TaaPlugin` — auto-installed by `CorePlugin` after `MotionBlurPlugin`; owns the jitter/param extract, the prepare system, and the Core3d graph wiring.
  - `TAA_WGSL` (`retro_engine::taa`), `TaaPipeline` / `TaaKey`, `makeTaaNode` / `TaaPass3dLabel`.
  - `ViewTaa` / `TaaParams`, `ViewTaaTargets` / `TaaCacheEntry`, `resolveTaaTargets` / `evictTaaTargets`, `TAA_TARGET_FORMAT`, `TAA_PARAMS_BYTE_SIZE`.
  - `haltonJitter` / `TAA_JITTER_SAMPLE_COUNT` — the Halton(2,3) jitter sequence.
  - `ViewJitter` / `JitterOffset` / `jitterProjection` — the camera-plugin jitter mechanism (pure, projection-agnostic).
  - `CurrentHdrView` — the per-camera HDR post-process handoff resource.

  **Behaviour changes:**

  - The view uniform grew by one `mat4x4<f32>` (`unjittered_view_proj`): `VIEW_UNIFORM_BYTE_SIZE` is now 416 B (was 352). `view_proj` carries any active sub-pixel jitter; `unjittered_view_proj` and `prev_view_proj` are jitter-free, and `prev_view_proj` is advanced with the unjittered matrix unconditionally.
  - `MotionBlur` and `Tonemapping` nodes now read their scene input from `CurrentHdrView` (falling back to the HDR intermediate) instead of hardcoding the motion-blur output lookup — output is identical, but a third post pass (TAA) now composes cleanly.

- 5b52805: feat(engine): world-space 3D text — glyph packer (ADR-0155, phase 3a)

  First slice of world-space `Text` (the Text P0 item's last acceptance criterion):
  `packGlyphInstance3d` + `TEXT3D_INSTANCE_BYTE_SIZE` / `TEXT3D_INSTANCE_FLOAT_COUNT`
  (`text/text-glyph-instance-3d.ts`). The packer transforms a laid-out glyph + a 3D
  `GlobalTransform` world matrix into a 68-byte world-space quad instance
  (`center.xyz` + `basisX.xyz` + `basisY.xyz` + uv rect + `unitRange` + packed tint)
  — the 2D packer's math extended from 2 to 3 components, so text orients on the
  entity's plane in 3D.

  Unit-tested (identity / z-translation / Y-rotation cases prove the third
  dimension). Additive and not yet wired into a render pass; ADR-0155 records the
  phase-3b plan (a `Text` component + depth-specialized pipeline drawn through the
  Core3d `ViewPhases3d.transparent` phase).

- dd3de07: feat(engine): world-space 3D text render path — `Text` component (ADR-0155, phase 3b)

  Adds the render path for world-space `Text` (the Text P0 item's last acceptance
  criterion), building on the 3a glyph packer.

  - New `Text` component (reflection-registered; same authored fields as `Text2d`
    — string, font, size, color, align, lineHeight, maxWidth, letterSpacing,
    anchor). The entity's 3D `GlobalTransform` positions/orients the text on its
    local plane; it's drawn through a 3D camera and depth-tested against the scene.
  - `text-3d.wgsl` (3D `view_proj`, shared MSDF fragment), a depth-specialized
    `Text3dPipeline` (`depthWriteEnabled: false`, `depthCompare: 'less-equal'`,
    keyed on the camera depth format), `Text3dInstanceBuffer` +
    `Text3dPreparedBatches`, and `prepareText3d`/`queueText3d` which queue one
    `PhaseItem3d` per entity into `ViewPhases3d.transparent` — drawn by the Core3d
    `TransparentPass3d` node (view + read-only depth already bound). Wired into
    `TextPlugin`.

  Integration-verified (`text3d-plugin.test.ts`, capturing renderer): a `Text` under
  a `Camera3d` emits one instanced draw into the `.transparent3d` pass (2 glyphs →
  instanceCount 2), atlas bound at `@group(1)`; no-font text is skipped. Bench:
  `text-prepare-3d`. Additive; the 2D `Text2d` path is untouched.

- d8c0bda: feat(engine): Font asset + Text2d component for MSDF text (phase 2a)

  Adds the asset + component layer of the engine text system:

  - `Font` asset (parsed `MsdfFont` data + a handle to its MSDF atlas `Image`) and
    the `Fonts` store.
  - `createFontImporter` — loads a `.font` descriptor (`msdf-atlas-gen` JSON),
    decodes its companion atlas image into a **linear** texture (distance fields
    are never gamma-decoded), and registers it as a labeled sub-asset. The atlas
    file defaults to a sibling `<base>.png`, overridable via a top-level `"image"`.
  - `Text2d` component (text, font handle, size, tint, alignment, line height,
    wrap width, letter spacing, pivot), reflection-registered so it round-trips
    through a saved scene.
  - `TextPlugin` — inserts `Fonts`, catalogs the `.font` asset kind, registers the
    loader against the `AssetServer`, and registers the `Text2d` schema.

  The glyph render pipeline (MSDF shader + quad batching through the 2D pipeline)
  is phase 2b; `TextPlugin` is not yet part of the default plugin set.

- b10dc50: feat(engine): MSDF text font data + layout engine (phase 1)

  Adds the pure, GPU-free core of the engine text system under
  `packages/engine/src/text/`:

  - `MsdfFont` / `FontMetrics` / `GlyphMetrics` — parsed font data (vertical
    metrics, per-codepoint advances/plane/atlas bounds, kerning, atlas geometry).
  - `parseMsdfFont(json)` — validates and parses the JSON produced by
    `msdf-atlas-gen`, throwing loudly on a malformed font.
  - `layoutText(font, text, options)` — shapes a string into positioned glyph
    quads (advances, kerning, letter spacing, explicit `\n`, greedy word wrap at
    `maxWidth`, left/center/right alignment) with top-left-origin atlas UVs.
  - `measureText(font, text, options)` — the cheap bounds-only path for UI layout.

  Rendering (a `Font` asset kind, the `Text2d` component, the MSDF shader, and
  glyph batching through the 2D pipeline) lands in a later phase.

- 05d2bb6: feat(engine): MSDF glyph render pipeline for Text2d (phase 2b)

  `TextPlugin` now renders `Text2d` entities. Added:

  - `retro_engine::text` WGSL — an MSDF shader that reconstructs a crisp edge from
    the median of the atlas's RGB distance channels, scaled to screen pixels via
    the font's `distanceRange` and the texture-coordinate derivative for
    resolution-independent antialiasing.
  - `TextPipeline` (a `SpecializedRenderPipelines` keyed on the render-target
    shape; always alpha-blended), `TextInstanceBuffer` (growable per-frame glyph
    buffer), and `TextPreparedBatches`.
  - `packGlyphInstance` — packs a laid-out glyph quad (block-local, y-down) into
    world-space instance data honoring the entity transform and block pivot, plus
    the per-glyph atlas UVs and MSDF `unitRange`.
  - `text-prepare` (after `image-prepare`) + `text-queue` render systems: lay out
    visible text, pack glyph quads in one upload, and queue one instanced
    transparent draw per text entity into the 2D phase.

  Text entities now draw; a text with no font, an unloaded font, or a
  whitespace-only string produces no draw. Verified end-to-end through the
  capturing renderer (transparent-pass draw calls, per-entity batching, instance
  counts, atlas bind group). A committed sample font + `?mode=text` playground
  scene follow in the next slice.

- 0f8701d: feat(engine): built-in SDF default font — zero-dependency crisp text (phase 2c)

  Adds a pure-JS signed-distance-field font generator and a built-in default font,
  so text renders with no external font tooling or committed binary assets:

  - `generateSdfFont(glyphs, options)` — rasterizes stroke-defined glyphs into a
    single-channel SDF atlas (replicated across RGB so the median-of-RGB shader
    reconstructs it) and returns the RGBA pixels plus parsed `MsdfFont` metrics.
  - `generateDefaultFontAtlas()` / `installDefaultFont(app)` — a built-in monoline
    font (uppercase, digits, common punctuation; lowercase aliased to uppercase)
    and a one-call helper that registers its linear atlas image + `Font` and
    returns the handle.

  The existing MSDF pipeline consumes the SDF atlas unchanged (single channel =
  median). True multi-channel MSDF atlases from `msdf-atlas-gen` still load via the
  `.font` importer when that tool is available; the built-in font is the
  no-tooling default.

- 7f40ed1: feat(engine): TextureAtlasLayout.fromRects (manual sprite slicing)

  `TextureAtlasLayout.fromRects({ size, rects })` builds an atlas layout from
  hand-placed pixel rects — the Unity "multiple" sprite mode for irregularly
  arranged sprite sheets, the manual counterpart to `fromGrid`:

  ```ts
  TextureAtlasLayout.fromRects({
    size: vec2.create(100, 50),
    rects: [
      { x: 0, y: 0, width: 40, height: 50 },
      { x: 50, y: 10, width: 50, height: 30 },
    ],
  });
  ```

  Each rect is normalised to UV against `size`, order-preserving (so
  `TextureAtlas.index` maps to `rects[index]`). Throws on a non-positive size or
  rect dimension. Fills the manual-rect slicing gap of sprite definitions;
  `TextureAtlasRect` / `TextureAtlasFromRectsOptions` are exported.

- 591fdef: feat(engine): TextureAtlasLayout + TextureAtlas component + atlas-sync + per-sprite frustum culling

  Phase 8.2 lands the texture-atlas data path on top of Phase 8.1's sprite pipeline. Per ADR-0032. A new `TextureAtlasLayout` value class carves a source image into normalised-UV sub-rects (either via `TextureAtlasLayout.fromGrid({ tileSize, columns, rows, padding?, offset? })` or a hand-authored `Rect[]` for sparse layouts); a new `TextureAtlas` component pairs an entity with a `(layout, index)`; a new `'atlas-sync'` system in `'postUpdate'` writes `sprite.rect = layout.textures[atlas.index]` once per frame on entities whose `TextureAtlas` changed. The existing sprite-prepare hot path consumes the resulting `rect` verbatim — no pipeline changes.

  As a load-bearing side effect, `SpritePlugin` now registers `'sprite-bounds'` in `'postUpdate'` (`after: ['atlas-sync']`), populating `Aabb` for sprite entities so the frustum-cull path that already runs in `checkVisibilitySystem` is finally active for sprites. Closes the per-sprite culling deferral from ADR-0031.

  **New public surface:**

  - `TextureAtlasLayout` — value class with `size: Vec2` (source-image pixel dimensions) + `textures: Rect[]` (in normalised UV). Static factory `TextureAtlasLayout.fromGrid({ tileSize, columns, rows, padding?, offset? })` emits `columns × rows` rects in row-major order.
  - `TextureAtlasLayouts` — main-world registry. API: `add(layout): TextureAtlasLayoutHandle`, `get(handle)`, `replace(handle, layout)`, `remove(handle)`, `has`, `size`, `iter`, `drainPendingChanges`. Auto-inserted by `SpritePlugin`.
  - `TextureAtlasLayoutHandle` — branded `number`, opaque identifier.
  - `TextureAtlasLayoutAssetEvent` — `{ kind: 'added' | 'modified' | 'removed'; handle }`.
  - `TextureAtlasFromGridOptions` — input shape for `TextureAtlasLayout.fromGrid`.
  - `TextureAtlas` — ECS component carrying `{ layout: TextureAtlasLayoutHandle; index: number }`. Spawn alongside `Sprite`: `cmd.spawn(new Sprite({ image }), new TextureAtlas(layout, 0))`. Mutate `atlas.index` + call `world.markChanged(entity, TextureAtlas)` to change frame.
  - `atlasSyncSystem` — pure system function. Registered by `SpritePlugin` with label `'atlas-sync'`. Exposed for tests / benches / custom registration.
  - `calculateSpriteBoundsSystem` — pure system function. Registered by `SpritePlugin` with label `'sprite-bounds'` (`after: ['atlas-sync']`). Auto-AABB for sprite entities so frustum culling kicks in. Skips entities carrying `NoFrustumCulling` for parity with the mesh equivalent.

  **Behaviour changes (non-breaking):**

  - `SpritePlugin.build` now inserts `TextureAtlasLayouts` and registers two systems in `'postUpdate'`. Plugins re-adding `SpritePlugin` are unaffected (insertion is idempotent).
  - Sprite entities now receive an `Aabb` component automatically. Code that previously relied on `Sprite` entities lacking `Aabb` (e.g. broad-phase queries) should attach `NoFrustumCulling` to the entities that should opt out.

- 42d7275: feat(engine): texture import settings (filter / wrap / color space)

  Phase 1 of texture import settings (ADR-0166). A `TextureImportSettings` shape
  (`filter` nearest/linear, `wrap` repeat/clamp/mirror, `colorSpace` srgb/linear)
  plus pure `resolveTextureSampler` / `resolveTextureColorSpace` and an
  `imageFromDecoded` builder. `createImageImporter(decode, settings?)` now applies
  settings as the project-wide default for every image it produces:

  ```ts
  server.registerLoader(
    "png",
    images,
    createImageImporter(decode, { filter: "nearest" })
  ); // crisp pixel-art
  server.registerLoader(
    "png",
    normalMaps,
    createImageImporter(decode, { colorSpace: "linear" })
  ); // data map
  ```

  Backward compatible — omitted settings reproduce the previous linear-filtered sRGB
  color image. Per-asset `.meta` overrides (via the asset server's `LoadContext`)
  and mipmaps / max-size / PPU are tracked follow-ups.

- b2a610d: feat(engine): per-asset texture `.meta` overrides

  Phase 2 of texture import settings (ADR-0166). A `<name>.meta` sidecar (UTF-8 JSON
  of `TextureImportSettings`) next to a texture overrides the importer's project
  default for that one texture:

  ```jsonc
  // wood.png.meta
  { "filter": "nearest", "wrap": "repeat", "colorSpace": "linear" }
  ```

  The image importer reads its own sibling `.meta` through the load context and
  merges the recognized fields over the default; a missing or malformed sidecar is
  silently ignored. New `parseTextureMeta` (keeps only valid fields, throws only on
  non-JSON) and `textureMetaSibling`. Implemented importer-local — no asset-server
  or `LoadContext`-shape change. Baking `.meta` into the packed manifest for the
  bundle path is a tracked follow-up.

- 2beee52: feat(engine): Transform + Hierarchy with propagation (M2 phase 7)

  Adds the engine's core spatial primitives:

  - `Transform` — single component carrying `translation: Vec3`, `rotation: Quat`, `scale: Vec3`. Required Components auto-attaches a `GlobalTransform`.
  - `GlobalTransform` — world-space `Mat4` written each `'postUpdate'` by the engine's propagation system. Auto-registered in the `App` constructor (mirroring the `Time` tick auto-registration).
  - `Parent` / `Children` — hierarchy edges; the propagation system reads `Parent` only, `Children` is maintained for ergonomic queries.
  - `EntityCommands.withChildren((parent) => parent.spawn(...))`, `.addChild(child)`, `.removeChild(child)`, `.despawnRecursive()` — hierarchy-building sugar on the `Commands` API.
  - `CommandsHandle.spawn(...)` now returns `EntityCommands` (was `Entity`); the entity id remains accessible via `.id`. Required so `cmd.spawn(...).withChildren(...)` chains naturally.

  Propagation is depth-sorted by parent walk, single-threaded, recomputed every `PostUpdate`. Orphan children (`Parent.entity` is dead) and `Parent`-chain cycles are handled gracefully via `Logger.devWarn` — no crashes, no silent corruption.

  In `@retro-engine/ecs`: adds `Query.entries()` yielding `[Entity, ...row]`, the entity-id-bearing variant of the standard query iterator. Used by the propagation system; available to any consumer needing entity ids alongside component data.

  Sealed in ADR-0010.

- 5cf81f9: feat(engine): visibility & CPU culling — three-component pipeline + Aabb/Frustum (Renderer Phase 3)

  First consumer of the `RenderLayers` mask shipped in Phase 2. Per ADR-0021, every `App` now runs a hierarchical visibility resolution and per-camera frustum-and-layer cull in `'postUpdate'`, writing each renderable entity's `ViewVisibility.visible` boolean for downstream phases to gate on.

  **Math primitives (`packages/math/src/`):**

  - `Aabb` — `{ center, halfExtents }` axis-aligned bounding box. Static factories `fromMinMax`, `fromPoints`, `transform` (writes the world-space AABB of a local-space box under a column-major 4×4).
  - `Plane` — `{ normal, d }` with `setFromCoefficients` (self-normalises) and `signedDistance(point)`.
  - `Frustum` — six inward-facing planes in canonical order `[left, right, bottom, top, near, far]`. `Frustum.fromViewProj(viewProj, dst?)` extracts via Gribb–Hartmann from a column-major view-projection matrix; WebGPU clip-space convention (`z ∈ [0, 1]`). `frustumIntersectsAabb(frustum, aabbWorld)` runs the positive-vertex test against a _world-space_ AABB.

  **Components (`packages/engine/src/visibility/`):**

  - `Visibility` — `mode: 'Inherited' | 'Hidden' | 'Visible'`, default `'Inherited'`. Required Components chains to `InheritedVisibility` and `ViewVisibility` automatically.
  - `InheritedVisibility` — `visible: boolean`. Resolved per frame from the `Visibility` hierarchy walk: `'Hidden'` → false; `'Visible'` → true (overrides hidden ancestor); `'Inherited'` → parent's value or true at a root.
  - `ViewVisibility` — `visible: boolean`. Per-frame aggregate: true iff at least one active camera passed both layer-mask and frustum-vs-AABB tests.
  - `NoFrustumCulling` — marker that short-circuits the frustum test (still respects hierarchy and render layers). Use for entities whose AABB is unreliable — particles, pre-skin skinned meshes, runtime-resized debug primitives.

  **Engine wiring:**

  - `Camera` declares `static requires = [Frustum]` — every camera auto-receives a `Frustum` component on spawn.
  - `VisibilityPlugin` is auto-installed by `CorePlugin` after `CameraPlugin`. It registers three `'postUpdate'` systems in the documented `VisibilitySystems` order: `updateFrustaSystem` → `visibilityPropagateSystem` → `checkVisibilitySystem`. The `CalculateBounds` slot is reserved for Phase 6 (mesh AABB auto-build) and registers no system yet.

  **Behaviour notes:**

  - Entities without `Visibility` are not iterated by the visibility pipeline at all — Required Components is opt-in via `new Visibility(...)`. Renderables that opt in but lack an `Aabb` or `GlobalTransform` are treated as always-visible (no culling possible).
  - `ViewVisibility` is a boolean aggregate across all active cameras. Per-camera filtering (visible from camera A but not B) will land alongside the render graph in Phase 5; the current shape can be extended additively without breaking consumers.
  - Hierarchical propagation reuses the same dirty-set + BFS-via-`Children` gating as transform propagation — orphan-parent and cycle handling produce a once-per-frame `devWarn` per offending entity.
  - The playground triangle is unaffected — it spawns no `Visibility` component, so the visibility pipeline ignores it and it renders unchanged.

- ce20898: feat(runtime-web): load the project's startup scene in the web export (ADR-0173)

  A scene-driven project (entities authored in a `.rescene`) now boots with its
  world in the web export, not an empty one. `bootWebGame` gains a `startupScene`
  option; when set it installs a game-runtime baseline via the new
  `installGameRuntime` (render stack — prepass / StandardMaterial / lights /
  skybox — plus the scene + asset runtime with mesh/image/material/glTF loaders,
  every add guarded so a project can override) and loads + spawns the scene via
  `loadAndSpawnScene` before the run loop. The web export threads
  `descriptor.startupScene` from `runWebExport` → `WebExportTarget` → `emitWebBoot`.
  `App.hasPlugin(name)` is added to let a host install a baseline plugin only when
  the project has not supplied its own.

  Also fixes engine frustum culling of **skinned meshes**: they were culled by
  their mesh bind-pose AABB, which a posed/animated skeleton deforms beyond — so a
  character could wrongly vanish (it only showed in a multi-camera editor where
  another camera framed the bind box). Entities with a `Skeleton` now skip the
  bind-pose frustum test (like `NoFrustumCulling`), so posed characters render
  correctly under a single game camera. (Joint-derived skinned bounds are a
  tracked follow-up.)

- 823e5cd: feat(engine): `Window` resource + `WindowResized` event (P1 windowing, phase 1)

  Adds the read side of windowing: a `Window` resource mirroring the drawing
  surface, so game code reads the logical size (for camera aspect, UI layout,
  pointer math) without reaching for DOM globals — keeping it headless-safe.

  - `Window` resource: `width` / `height` (logical CSS px), `physicalWidth` /
    `physicalHeight` (backing px), `devicePixelRatio`.
  - `WindowResized` message, emitted the frame the logical size changes (incl. the
    first frame it becomes known) — read with `MessageReader(WindowResized)`.
  - `syncWindow(window, physicalW, physicalH, dpr)` pure fold (returns whether the
    logical size changed), and an opt-in `WindowPlugin` that inserts the resource
    and syncs it from the surface each frame in `'first'`, emitting `WindowResized`
    on change. Headless-safe (no surface → no-op).

  Unit-tested (dpr division, change detection, dpr guard) + a capturing-renderer
  integration test (Window reflects the surface; `WindowResized` fires once on
  first sight, not on a steady size). Cursor / fullscreen / present-mode /
  multi-window remain follow-ups.

### Patch Changes

- e73d32e: fix(engine): change-gate calculateBoundsSystem on Mesh3d

  The auto-AABB writer re-derived a local-space `Aabb` for every `Mesh3d` entity
  on every frame. `Mesh.computeAabb()` is an O(vertices) walk of the position
  buffer, so the cost scaled with both entity count and mesh density — a profile
  of a medium stress scene showed `Aabb.fromPoints` dominating the frame (~55% of
  main-thread CPU, ~7 ms/frame), capping the frame rate well below the display's
  refresh.

  A mesh's local-space bounds only move when its geometry does, so the system's
  query is now gated on changed `Mesh3d`: an entity is visited on the frame its
  `Mesh3d` is added and again only when `Mesh3d` is flagged changed. Steady-state
  cost on an idle scene drops ~100× (measured: 1024 entities, 1.11 ms → 10 µs).

  **Behaviour change:** editing a `Mesh`'s vertex data in place while keeping the
  same handle no longer refreshes bounds on its own, because the gate keys on the
  `Mesh3d` component rather than the `Mesh` asset. Signal such an edit by
  re-inserting `Mesh3d` on each affected entity (or
  `world.markChanged(entity, Mesh3d)`). Spawning, swapping the mesh handle, and
  adding `Mesh3d` are unaffected — those already flag the component.

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

- 5317052: fix(engine): clamp HDR radiance during IBL prefilter (no more Inf/NaN env patches)

  The environment irradiance convolution and specular prefilter
  (`environment.wgsl`) accumulated raw source-cube radiance with no upper bound.
  Real HDR skies contain extreme or non-finite values — a sun disc that overflows
  half-float to `+inf`, or values in the tens of thousands. Unbounded, these
  corrupted the baked maps: `+inf` propagated into irradiance/specular texels, the
  `radiance * cos * sin` hemisphere weighting produced `inf * 0 = NaN` at the pole,
  and the tiny ultra-bright sun aliased into firefly speckle the finite sample
  counts could not resolve.

  Surfaces shaded by those texels showed sharp white patches (huge/`inf`
  irradiance) and black patches (`NaN`) under an environment map — most visible on
  low-poly characters whose flat faces each sample a distinct direction. The
  skybox was unaffected because it samples the source cube directly without
  convolution.

  Each sampled radiance is now clamped to a finite cap before accumulation, so the
  bake stays smooth and finite while preserving the sky's overall brightness.

- 5599db7: fix(engine): a malformed material value no longer freezes the render loop

  Two compounding gaps closed (see the render-loop-freeze bug):

  - **`StandardMaterial` validates its vec fields at construction.** `baseColor` / `emissive` are coerced to a length-4 `Vec4` — a short value is padded from the default (so `emissive: [1, 1, 1]` becomes `[1, 1, 1, 0]`), and a non-array-like or non-numeric value throws a clear error _at construction_ instead of deep in the uniform packer mid-frame.
  - **`MaterialPlugin.prepareMaterials` isolates per-material failures.** Each material's uniform pack is wrapped in try/catch: a throwing material is logged once and skipped (the rest of the scene keeps rendering) rather than aborting the whole prepare pass and freezing the frame loop.

  Verified by unit tests (constructor padding/rejection; a deliberately malformed material is skipped while a good one still prepares).

- 5988cb6: fix(engine): skip non-3D cameras in the material queue

  `MaterialPlugin.queueMaterials3d` iterated every camera view and pushed
  `PhaseItem3d` entries keyed by each camera's entity, with no sub-graph filter. In
  a world hosting both a `Camera2d` and a `Camera3d`, the 2D camera accrued 3D phase
  items its Core2d sub-graph never drains — wasted work bounded by
  `(2D cameras) × (3D renderables)` per frame. The queue now skips views whose
  `subGraph !== Core3dLabel`, symmetric to `SpritePlugin.queueSprites` filtering
  `Core2dLabel`.

- a055d25: fix(engine): a mesh missing a shader-required vertex attribute no longer freezes the renderer

  A mesh lacking an attribute the material's vertex shader declares (e.g. an imported glTF with no `TEXCOORD_0` under the PBR shader) used to build an invalid pipeline, which poisoned the frame's command encoder and froze the whole viewport with no surfaced error.

  `MaterialPlugin` now checks, before building a pipeline, that the mesh's vertex layout provides every attribute the material requires (`Material.requiredMeshAttributes()`, defaulting to the standard `POSITION` / `NORMAL` / `UV_0` set the built-in PBR / unlit shaders consume). A mesh missing any required attribute has its draw skipped, with one dev warning per mesh, containing the blast radius to that one entity instead of the entire frame. Applies to the mesh, skinned, and (implicitly, unchanged) morph paths.

  Unit-tested via `missingMeshAttributes` (the guard's decision over provided-vs-required attribute ids).

- 2a7a18b: fix(engine): OBJ base mesh + bake insert NORMAL before UV (correct shader binding)

  `parseObjBaseMesh` and `bakeMorphedMesh` inserted `POSITION, UV_0`, then appended
  `NORMAL` last (via `computeSmoothNormals`). The vertex-buffer layout follows
  insertion order, and the PBR shader binds `@location(0/1/2) = POSITION/NORMAL/UV`
  — so UV data was fed into the `normal` input and normals into `uv`, rendering the
  base mesh (and any baked character) with wrong lighting and wrong texturing
  (silently, since the format mismatch defaults rather than failing). They now insert
  a `NORMAL` placeholder before `UV_0` (overwritten in place by `computeSmoothNormals`),
  giving the canonical `POSITION, NORMAL, UV` order. The glТF path was already
  correct and is unaffected.

- da51d57: fix(engine): guard perturb_normal against degenerate UVs (NaN IBL normal)

  `perturb_normal` in `pbr.wgsl` reconstructs a tangent frame from screen-space UV derivatives. On zero-area UV triangles (common where a low-poly atlas collapses a surface region to a single texel) the UV gradient is zero, so `inverseSqrt(max(dot(t,t), dot(b,b)))` returned `+inf` and `0 * inf` produced a NaN shading normal — even when no normal map is bound and the function is meant to be a no-op.

  A NaN normal corrupted the image-based-lighting term (cube sampled at a garbage coordinate → a flat, constant dark texel), surfacing as sharp dark patches on atlas-textured characters under an environment map. The analytic/flat-ambient path is normal-independent, so the artifact only appeared with IBL on.

  The normalizer is now clamped away from zero, so a degenerate UV gradient correctly falls back to the geometric normal. Materials with a normal map are unaffected except on the same degenerate triangles, where they now also fall back instead of producing NaN.

- c2732c5: fix(renderer): Core3d transparent pass used an invalid read-only depth attachment

  The 3D transparent pass (`TransparentPass3dNode`) set `depthReadOnly: true`
  together with `depthLoadOp: 'load'` / `depthStoreOp: 'discard'`. WebGPU forbids
  setting the load/store ops when `depthReadOnly` is true, so the pass produced an
  invalid `CommandBuffer` and dropped every frame that contained a transparent 3D
  draw. It went unnoticed because nothing used the 3D transparent phase until
  world-space text (ADR-0155) became its first consumer.

  - `@retro-engine/renderer-core`: `DepthStencilAttachment.depthLoadOp` /
    `depthStoreOp` are now optional (they are mutually exclusive with
    `depthReadOnly`, per the WebGPU spec).
  - `@retro-engine/renderer-webgpu`: the encoder only forwards `depthLoadOp` /
    `depthStoreOp` when set (omitted for a read-only depth attachment).
  - `@retro-engine/engine`: `TransparentPass3dNode` builds a read-only depth
    attachment with no load/store ops — the opaque depth still gates transparent
    fragments (pipelines carry `depthWriteEnabled: false`).

  Verified in a real browser: world-space 3D text now renders through the 3D
  transparent pass with no validation errors and is correctly occluded by nearer
  opaque geometry.

- 781aa88: fix(engine): materials fall back to a default texture while one is still loading

  A material referencing a texture that hadn't finished loading (an async decode +
  GPU upload — e.g. a loose PNG assigned to `baseColorTexture`) threw in
  `resolveImageBinding` during `prepareMaterials`, aborting the whole render loop:
  `could not resolve image handle N via RenderImages`. Assigning a texture and
  reloading a scene that referenced it would crash on every frame.

  `resolveImageBinding` now falls back to the default image (white / black /
  normal-flat) when the material's own texture isn't uploaded yet, and only throws
  when the _default_ is also missing (the genuine "ImagePlugin not registered"
  setup error). `prepareMaterials` re-prepares a material whose textures aren't all
  ready each frame until they land — so it renders with the default, then swaps in
  the real texture once it uploads, with no crash.

- d63d0f9: fix(engine): pad mesh buffer uploads to a 4-byte multiple

  WebGPU's `writeBuffer` rejects a byte length that is not a multiple of 4. A `uint16` index buffer with an odd index count (e.g. a single triangle — 3 indices, 6 bytes) is `2 mod 4` and failed to upload. The `MeshAllocator` already sizes each allocation to a 4-byte multiple, but wrote the raw unpadded data; it now zero-pads the upload to the same alignment. Built-in primitives have even index counts so never hit this, but imported meshes (glTF) routinely have odd counts.

- ac35dac: perf(ecs): non-allocating Query.forEach for hot-path iteration

  `Query.entries()` / the row iterator allocate a fresh `[entity, ...components]`
  tuple per row and run through a generator — and a profile of the stress preset
  showed that per-frame query iteration, not the render prepare, had become the
  dominant cost once retained prep (ADR-0039) landed (systems that touch every
  entity each frame allocate ~one tuple per entity per query).

  Adds `Query.forEach(cb)` (backed by `World.forEachEntry`) that reuses a single
  row buffer across all rows and invokes the callback directly — no per-row array,
  no generator. Bench: **~4–6× faster** than `.entries()` iterating 100k entities
  (entity + 3 components). The row passed to the callback is transient — read it
  in the callback, don't retain it; `.entries()` stays for the retain-safe /
  collect case and is unchanged.

  The engine's per-frame O(n) loops migrate to it (no behavior change, parity
  tests green): the visibility cull, the retained sprite + 3D/2D mesh prepare base
  walks, and the atlas animation ticker. Also factors the shared archetype-match
  test out of the two existing query iterators.

  **New public surface:** `Query.forEach`.

- abbd55c: fix(engine): restrict the screen-space prepass to opaque materials

  Alpha-masked (`alphaMode: 'mask'`) and blended (`'blend'`) materials no longer write the depth/normal/motion prepass; only opaque geometry does.

  The prepass rasterises whole primitives, so an alpha-tested material wrote prepass depth for the full leaf-card geometry — including the fully-transparent texels its forward pass later discards. Because the prepass cannot reproduce the forward pass's exact per-fragment alpha coverage, those texels left depth with no shaded colour, occluding everything behind them and showing the camera's clear colour: a hole "moving with" any alpha-masked model (e.g. a glTF foliage model), cutting through the editor grid and any geometry behind it.

  Opaque materials are unaffected. Alpha-masked / transparent materials establish their own depth in the forward pass (the opaque/alpha-mask phase writes depth), so they still occlude correctly — there is just no separate prepass pass for them.

  Trade-off: alpha-masked materials no longer contribute to prepass-derived effects (screen-space AO occlusion, TAA motion vectors). Restoring that for alpha-tested geometry requires the prepass and forward pass to share identical per-fragment coverage and is tracked as follow-up work.

  **Touched:** `MaterialPlugin.queuePrepassFromEntries` (skips entries whose `alphaMode()` is not `'opaque'`).

- fa2678b: feat(renderer-hal): resource factories, bind groups, and render targets (ADR-0018)

  Closes the HAL gaps Phase 1 of the renderer roadmap calls out — every later phase (cameras, materials, sprites, lighting) needs to allocate buffers, sample textures, and bind resources to a pipeline.

  ### Resource factories

  `Renderer` gains `createBuffer`, `createTexture`, `createSampler`, `writeBuffer`, `writeTexture`. Buffers expose `size` + `usage`. Textures expose dimensions, format, mip/sample counts, usage flags, and `createView(descriptor?)`.

  Usage flags are numeric bitfields exposed via const-namespaces — `BufferUsage`, `TextureUsage` — whose values match WebGPU's `GPUBufferUsage` / `GPUTextureUsage` for zero-cost passthrough in the WebGPU backend.

  ### Binding model

  `Renderer` gains `createBindGroupLayout`, `createPipelineLayout`, `createBindGroup`. `RenderPipelineDescriptor.layout` widens from `'auto'` only to `'auto' | PipelineLayout`. `RenderPassEncoder.setBindGroup` is now implemented (previously threw with "bind groups arrive with sprite rendering").

  `ShaderStage` const-namespace exposes `VERTEX`, `FRAGMENT`, `COMPUTE` bits matching WebGPU. Bind-group layout entries accept `buffer | sampler | texture | storageTexture` discriminators.

  ```ts
  const layout = renderer.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: ShaderStage.FRAGMENT,
        buffer: { type: "uniform" },
      },
    ],
  });
  const pipelineLayout = renderer.createPipelineLayout({
    bindGroupLayouts: [layout],
  });
  const bindGroup = renderer.createBindGroup({
    layout,
    entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
  });

  renderer.createRenderPipeline({ layout: pipelineLayout /* ... */ });
  pass.setBindGroup(0, bindGroup);
  ```

  ### RenderTarget abstraction

  New `RenderTarget` tagged union (`surface | texture | view`) and `Renderer.resolveRenderTarget(target)` that returns `{ view, format, width, height }`. Phase 1 ships all three variants so future cameras (Phase 2) can target offscreen images without further HAL extension. `Surface` gains `format` / `width` / `height` getters to support surface-backed targets.

  ### File layout

  `packages/renderer-core/src/index.ts` is now a public re-export entry point only, per CLAUDE.md §5.5. Concerns live in sibling files: `capabilities.ts`, `formats.ts`, `shader.ts`, `resources.ts`, `binding.ts`, `pipeline.ts`, `encoder.ts`, `surface.ts`, `render-target.ts`. The WebGPU backend mirrors the split. Engine consumers continue importing from `@retro-engine/renderer-core` — no path changes.

  ### API surface (additive, no breakage)

  - New methods on `Renderer`: `createBuffer`, `createTexture`, `createSampler`, `writeBuffer`, `writeTexture`, `createBindGroupLayout`, `createPipelineLayout`, `createBindGroup`, `resolveRenderTarget`.
  - New types: `BufferDescriptor`, `TextureDescriptor`, `TextureViewDescriptor`, `SamplerDescriptor`, `BindGroupLayoutDescriptor`, `BindGroupLayoutEntry`, `PipelineLayoutDescriptor`, `BindGroupDescriptor`, `BindGroupEntry`, `BufferBinding`, `BindingResource`, `RenderTarget`, `ResolvedRenderTarget`, `ImageCopyTexture`, `ImageDataLayout`, `Extent3D`, plus binding-layout sub-types.
  - New const-namespaces: `BufferUsage`, `TextureUsage`, `ShaderStage`.
  - `Surface` gains `format`, `width`, `height` getters.
  - `Buffer` gains `usage`; `Texture` gains `depthOrArrayLayers`, `format`, `mipLevelCount`, `sampleCount`, `usage`, `createView`.

  ### Engine touch

  `packages/engine/src/test-utils.ts` consolidates `makeHeadlessRenderer` / `makeRenderingRenderer` so the engine's 16 test files don't each maintain their own `Renderer` stub. Excluded from the shipped build via `tsconfig.build.json` — no API surface change.

  ### ADR provenance

  - Seals ADR-0018.
  - Sits on top of ADR-0003 (renderer HAL) — extends the contract; does not supersede it.
  - Foundation for ADR-0019 (render world + render schedule sets, milestone B) and every later renderer-roadmap phase.

- 48686b4: fix(engine): change-gate sprite bounds + trim checkVisibility per-entity lookups

  Two CPU-side wins on the per-frame visibility path, found in the post-instancing
  "large" stress trace:

  - **`calculateSpriteBoundsSystem` is change-gated.** It previously recomputed a
    local `Aabb` and `insertBundle`'d it for every sprite every frame (the 2D twin
    of the `calculateBoundsSystem` issue). It now runs only for sprites whose
    `Sprite` or `TextureAtlas` changed (the union of two `changed` queries,
    deduplicated). **Behaviour change:** mutating an underlying `Image`'s
    dimensions or a `TextureAtlasLayout` in place no longer refreshes a sprite's
    bounds on its own — re-insert `Sprite` or call
    `world.markChanged(entity, Sprite)`. Spawning, mutating `Sprite`/`TextureAtlas`,
    and atlas animation already flag the component, so they refresh normally.

  - **`checkVisibilitySystem` does fewer `getComponent` calls.** `NoFrustumCulling`
    presence now comes from a `has` row flag instead of a lookup, and `Aabb` /
    `GlobalTransform` are fetched once per entity instead of twice — roughly
    halving the per-entity lookups on the cullable path. No behaviour change.

- Updated dependencies [937f2cb]
- Updated dependencies [d5424c3]
- Updated dependencies [c1b257b]
- Updated dependencies [2ea4d68]
- Updated dependencies [3b3cf7f]
- Updated dependencies [8029403]
- Updated dependencies [2324f9f]
- Updated dependencies [6e1d04c]
- Updated dependencies [5ea3e80]
- Updated dependencies [2f22822]
- Updated dependencies [62e382e]
- Updated dependencies [9e2aaf5]
- Updated dependencies [1280e03]
- Updated dependencies [e163274]
- Updated dependencies [c2732c5]
- Updated dependencies [fad8a5e]
- Updated dependencies [8e4574a]
- Updated dependencies [0eca147]
- Updated dependencies [3db9d87]
- Updated dependencies [8029403]
- Updated dependencies [ac35dac]
- Updated dependencies [67e8513]
- Updated dependencies [f8079c6]
- Updated dependencies [e6728cc]
- Updated dependencies [a896a3b]
- Updated dependencies [690c811]
- Updated dependencies [da1f0eb]
- Updated dependencies [5c33631]
- Updated dependencies [fa2678b]
- Updated dependencies [bcef667]
- Updated dependencies [9712180]
- Updated dependencies [bc24cd2]
- Updated dependencies [73fdef4]
- Updated dependencies [7142f6f]
- Updated dependencies [acae153]
- Updated dependencies [8934a75]
- Updated dependencies [2beee52]
- Updated dependencies [5cf81f9]
  - @retro-engine/assets@0.1.0
  - @retro-engine/renderer-core@0.1.0
  - @retro-engine/reflect@0.1.0
  - @retro-engine/ecs@0.1.0
  - @retro-engine/math@0.1.0
