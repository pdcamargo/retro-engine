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

- 7142f6f: docs(engine): seal ADR-0027 — TS-side AsBindGroup equivalent (class-static schema + `MaterialSchema` helper)

  Architectural shape decision recorded in `docs/adr/ADR-0027-bind-group-schema-and-material-schema-helper.md`. Materials declare their bind-group layout as `static bindGroup = MaterialSchema(Self, [...])`. The helper closes the rename-safety gap that a raw `as const satisfies BindGroupSchema<M>` would leave open — TypeScript can only check `fieldKey: keyof M & string` when the helper binds the class reference through a generic parameter.

  Rejected alternatives:

  - **TC39 Stage-3 decorators** — `tsconfig.base.json` does not enable `experimentalDecorators`; the decorator runtime is still settling. Lands when a second consumer also wants the syntax.
  - **Registry / builder pattern** — does not deliver compile-time rename safety; less consistent with the engine's existing class-static metadata convention (`Transform.requires`, component lifecycle hooks, `ShaderRegistry`).
  - **WGSL reflection** — the Phase 4 preprocessor is text-only; no AST. Lands with a WGSL parser ADR.

  Implementation ships under `feat(engine): material system, Core3d phase trio, per-camera depth automation`.

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

- 4ca7beb: feat(engine): event-driven visibility cull + retained prepares — ADR-0040

  ADR-0039 made the retained prepares pack and sort in O(changed), but left two per-frame O(n) base walks a static-but-visible entity still paid every frame: `checkVisibilitySystem` rewrote `ViewVisibility` for every renderable, and each retained prepare walked its whole visible set to detect spawns/despawns/visibility-flips. Both are now event-driven.

  - `checkVisibilitySystem` is change-gated: with an unchanged active-camera set it recomputes only entities whose own inputs changed (`Changed<GlobalTransform | Aabb | InheritedVisibility | RenderLayers>` + removed `Aabb`/`NoFrustumCulling`); any camera move/projection/add/remove (detected by a frustum + layer-mask snapshot compare) forces a full recompute identical to a per-frame walk. It now stamps `Changed<ViewVisibility>` only on a real flip, making visibility edges observable.
  - The retained sprite/mesh prepares maintain their slot set from those change events plus the removed buffer — no per-frame structural walk. A small pending set re-checks entities whose asset hasn't uploaded yet. The mesh prepare applies per-camera add/update/remove deltas and recomputes depth only when a camera's view matrix changed.

  This is the new implementation of the existing `{ retained: true }` plugin option (no new flag); the legacy full-repack path (`{ retained: false }`) stays as the fallback and parity reference. A static scene now does O(changed) cull + prepare work — bench shows the event-driven static frame ~7–9× faster than the legacy walk for meshes and ~2.3× for sprites, with far less per-frame allocation.

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

- 8934a75: System param protocol: `App.addSystem` now takes a tuple of param tokens plus a value-receiving function, with optional `runIf` run condition. Sealed as ADR-0006.

  - `packages/engine` exports `Param`, `ResolveCtx`, `SystemId`, `RenderCtx`, `Res`, `RunCondition`, `ParamValues`. Phase 1 ships `RenderCtx` (stage-scoped to `'render'`) and `Res(ctor)` against a minimal resource registry on `App` (`insertResource`, `getResource`).
  - `SystemFn` and `RenderSystemFn` types removed; the old `addSystem` overload pair is replaced by one signature: `addSystem(stage, params, fn, options?)`.
  - `packages/ecs` removes the unused `System` type alias.

  Migration: `addSystem('startup', () => {...})` → `addSystem('startup', [], () => {...})`. `addSystem('render', (world, ctx) => {...})` → `addSystem('render', [RenderCtx], (ctx) => {...})`.

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

- Updated dependencies [d5424c3]
- Updated dependencies [c1b257b]
- Updated dependencies [3b3cf7f]
- Updated dependencies [8029403]
- Updated dependencies [5ea3e80]
- Updated dependencies [2f22822]
- Updated dependencies [62e382e]
- Updated dependencies [1280e03]
- Updated dependencies [8029403]
- Updated dependencies [ac35dac]
- Updated dependencies [5c33631]
- Updated dependencies [fa2678b]
- Updated dependencies [9712180]
- Updated dependencies [bc24cd2]
- Updated dependencies [7142f6f]
- Updated dependencies [8934a75]
- Updated dependencies [2beee52]
- Updated dependencies [5cf81f9]
  - @retro-engine/assets@0.1.0
  - @retro-engine/renderer-core@0.1.0
  - @retro-engine/ecs@0.1.0
  - @retro-engine/math@0.1.0
