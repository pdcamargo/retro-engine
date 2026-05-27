# Renderer

- **Created:** 2026-05-23
- **Status:** Living (the renderer is never "done"; phases promote individually into `docs/backlog/`)
- **Supersedes:** `first-render-path.md` (shipped), `renderer-graph.md` (folded into Phase 5), `webgl2-backend.md` (folded into Phase 14)

## Goal

A WebGPU-first, WebGL2-reachable renderer with a Bevy-shaped architecture: two-world split (main world + render world with an extract stage between them), specialized render pipelines with a shader-as-asset preprocessor, a material trait with extension, a render graph for multi-pass composition, CPU frustum culling plus a path to GPU-driven culling, sprites and PBR meshes as equal first-class citizens, 2D and 3D lighting (including HDRI image-based lighting), glTF as the primary 3D interchange format.

Composition-only at every layer. Capability-gated for WebGL2 from day one. Single-threaded but designed so a future worker offload is not architecturally blocked.

The phases below are in **dependency order**. Foundations (HAL completion, render-world split, cameras, visibility, shader system, render graph) land before any consumer-facing feature (sprites, materials, lights, glTF, post-processing). Each phase is the seed of one or more `docs/backlog/*.md` items — phases are promoted when concrete work is scheduled, not all at once.

## Phases

### Phase 0 — Shipped (status snapshot, not work)

- HAL contract — `renderer-core` interfaces (ADR-0003).
- WebGPU backend basics — adapter, device, surface, shader module compilation, render pipeline construction, command encoder, render pass, submit.
- Engine `render` stage with a per-frame `RenderContext` (encoder + pass + surface view) injected into render systems.
- A single triangle witnessed end-to-end in `apps/playground` (browser-only).
- `Transform` / `GlobalTransform` / `Parent` / `Children` with depth-first propagation in `postUpdate` (ADR-0010).
- Component and resource change detection (ADR-0014, ADR-0015, ADR-0016).

### Phase 1 — HAL completion & render-world split

The HAL is missing the resource factories every other phase depends on, and the engine currently runs one fixed render pass per frame in the main world. Both gaps close here.

- **1.1 GPU resource factories** — `createBuffer`, `createTexture`, `createSampler`, `writeBuffer`, `writeTexture` on `Renderer` and the WebGPU backend. Currently absent.
- **1.2 Bind groups + layouts** — `BindGroupLayout`, `PipelineLayout`, `BindGroup`. `setBindGroup` currently throws. Required by every uniform from here on.
- **1.3 `RenderTarget` abstraction** — `Window | Texture | TextureView` so cameras can target offscreen images, not just the swapchain.
- **1.4 Render-world architecture** — separate `World` instance for render-only data, with an `ExtractSchedule` stage that runs after `Last` and before `Render` and copies the rendering slice (active cameras, visible-entity transforms, mesh handles, material handles, etc.) into the render world. Likely needs an ADR.
- **1.5 Render schedule sets** — inside the `Render` stage of the render world: `ExtractCommands → Prepare → Queue → PhaseSort → Render → Cleanup`, mirroring Bevy.

### Phase 2 — Camera & view

Nothing meaningful renders without a camera. Camera is also where view layers, render targets, and clear-color all attach.

- **2.1 `Camera`** — active, order, viewport, target (`RenderTarget`), hdr, msaaWriteback, clearColor.
- **2.2 `Projection`** — `PerspectiveProjection` and `OrthographicProjection` with `WindowSize | Fixed | AutoMin | AutoMax` scaling modes.
- **2.3 `Camera2d` / `Camera3d`** — marker bundles that wire `CameraRenderGraph(Core2d | Core3d)` plus default `Projection`.
- **2.4 `ClearColor`** — global resource fallback when no per-camera clear color is set.
- **2.5 `RenderLayers`** — bitmask component on both cameras and renderables; an entity is visible to a camera only if their layer masks intersect.
- **2.6 `SortedCameras`** — order cameras by `order`, run render-target cameras before window cameras so RT outputs feed downstream passes.

### Phase 3 — Visibility & CPU culling (foundation)

Visibility is the gate between "this entity exists in the world" and "this entity is drawn this frame for this camera." Done as a three-component pipeline before any large scene exists, so the upstream systems can rely on it.

- **3.1 `Aabb`** — local-space bounding box. Auto-computed for meshes; manual for custom renderables.
- **3.2 `Frustum`** — derived from each camera's view-projection each frame.
- **3.3 Three-component visibility** — `Visibility` (`Inherited | Hidden | Visible`), `InheritedVisibility` (hierarchy walk), `ViewVisibility` (per-view, set by culling).
- **3.4 `VisibilitySystems` set order** — `CalculateBounds → UpdateFrusta → VisibilityPropagate → CheckVisibility`.
- **3.5 `NoFrustumCulling`** — opt-out marker for entities whose AABB would be a lie (skinned meshes pre-skin-bounds, particle systems, etc.).
- **3.6 `VisibilityRange`** — distance-based culling; also the seed for LOD.

### Phase 4 — Shader system

Custom shaders are user-facing from the moment materials exist, so the system has to be in place before §7. The 2D path (§8) also wants `SpritePipeline` specialization, so this lands before §6 even though it is not strictly mesh-related.

- **4.1 Shader as a typed handle** — `Shader` is an asset once the asset system exists; raw-source factory before that.
- **4.2 WGSL preprocessor** — `#import`, `#define`, `#ifdef`. Homegrown; naga's preprocessor is Rust-only and not available to us.
- **4.3 `PipelineCache`** — dedupe compiled pipelines by descriptor hash. Asynchronous pipeline creation friendly.
- **4.4 `SpecializedRenderPipeline`** — `Key → RenderPipelineDescriptor` mapping function with cache. Key encodes things like MSAA sample count, HDR, vertex layout, tonemap method.
- **4.5 `ShaderRef`** — `Default | Path | Handle` abstraction so materials and the render graph reference shaders uniformly.
- **4.6 Custom shader registration API** — surface for end users (and plugins) to register WGSL.
- **4.7 Hot reload** — dev-mode only, gated behind a flag; never in shipped builds.

### Phase 5 — Render graph *(absorbs `renderer-graph.md`)*

The single hand-rolled pass in Phase 0 is replaced by a declarative graph the moment we need two passes (sprite + tonemap, or main + post). Cameras pick which sub-graph drives them.

- **5.1 `Node` / `ViewNode`** — declarative pass with typed input/output slots.
- **5.2 `RenderSubGraph`** — `Core2d` and `Core3d` ship as the initial sub-graphs.
- **5.3 `RenderLabel`** — node identity + typed edges so the graph topologically sorts and dependencies are checked.
- **5.4 `CameraDriverNode`** — iterates `SortedCameras`, runs each camera's sub-graph in order.
- **5.5 Transient resource allocator** — intra-frame textures/buffers with aliasing.
- **5.6 Cross-frame history resources** — TAA and other temporal effects.
- **5.7 Migration** — replace the current single-pass with a graph-driven equivalent. The hand-orchestrated `renderFrame()` becomes one default node.
- **5.8 Studio render-graph visualizer** — deferred to Phase 15.

### Phase 6 — Meshes & primitives

Mesh data exists as a CPU asset (`Mesh`) and a GPU representation (`RenderMesh`). Primitives are factories that emit a `Mesh`.

- **6.1 `Mesh` asset** — typed vertex attributes, optional indices, topology.
- **6.2 `MeshVertexAttribute`** — typed slots: `POSITION`, `NORMAL`, `UV_0`, `TANGENT`, `COLOR`, `JOINT_INDEX`, `JOINT_WEIGHT`.
- **6.3 `RenderMesh`** — GPU-side representation (vertex/index buffer ranges).
- **6.4 `MeshAllocator`** — pack vertex/index data into shared GPU buffers via sub-allocations. Enables batching downstream.
- **6.5 `Meshable` trait + 3D primitives** — `Cuboid`, `Sphere`, `Cylinder`, `Capsule3d`, `Torus`, `Plane3d`, `Cone`, `Tetrahedron`, `ConicalFrustum`.
- **6.6 2D primitives** — `Rectangle`, `Circle`, `Annulus`, `RegularPolygon`, `Triangle`, `Ellipse`.

### Phase 7 — Material system

Materials sit on top of the shader system and the mesh system. `ExtendedMaterial` is the composition tool for users who want PBR-plus-extra without forking `StandardMaterial`.

- **7.1 `Material` trait + `MaterialPlugin<M>`** — registers extraction, specialization, queueing for that material type.
- **7.2 `AsBindGroup` equivalent** — map a TypeScript class's fields → bind-group entries. Decorator-driven + reflection; TS doesn't have derive macros. Almost certainly an ADR.
- **7.3 `Mesh3d` + `MeshMaterial3d<M>`** — the canonical "renderable mesh" component pair.
- **7.4 Material knobs** — `alpha_mode`, `depth_bias`, `opaque_render_method`.
- **7.5 `ExtendedMaterial<Base, Extension>`** — compose a base's bind group with extra bindings and shader overrides without duplicating PBR code.
- **7.6 `StandardMaterial`** — PBR metallic-roughness (base color, metallic, roughness, normal, emissive, occlusion). Consumes IBL from Phase 10.7.
- **7.7 `UnlitMaterial`** — minimal baseline; reference implementation for users writing their own `Material`.

### Phase 8 — 2D rendering: Sprites & SpriteMap

The 2D path is a parallel track to §7 and runs through its own dedicated batched pipeline (`SpritePipeline`), not through `Material2d`, for perf reasons. `Material2d` exists alongside for arbitrary 2D geometry.

- **8.1 `Sprite`** — texture handle, color tint, anchor, flip X/Y, custom size.
- **8.2 `TextureAtlasLayout`** — asset describing sub-rects (grid + irregular regions). This is the "sprite map" / sprite sheet.
- **8.3 `TextureAtlas`** — component pairing an atlas layout handle with a current index.
- **8.4 `SpritePipeline`** — dedicated batched 2D path.
- **8.5 `TextureSlicer`** — 9-slice sprites.
- **8.6 `Core2d` sub-graph phases** — `Opaque2d`, `AlphaMask2d` (binned by pipeline + mesh), `Transparent2d` (Z-sorted).
- **8.7 `Material2d` + `Mesh2d` + `MeshMaterial2d<M>`** — arbitrary 2D geometry with custom shaders.
- **8.8 Automatic sprite batching** — same atlas + pipeline → one draw call.

### Phase 9 — 2D lighting

**Status: Shipped.** ADR-0037 (9.1 `PointLight2d` + accumulation/composite),
ADR-0041 (9.1 `SpotLight2d`/`DirectionalLight2d`/`AmbientLight2d` + 9.3 composite
modes), ADR-0042 (9.4 shadow occluders — per-light 1D shadow maps), ADR-0043
(9.5 normal-map-aware lighting). Browser-verified in `apps/playground`
(`?mode=lights`, `&normals=1`). All four extend ADR-0037 without superseding it.

Bevy doesn't ship 2D lighting in core; the community implements it as accumulation-then-composite. Same pattern here.

- **9.1 `PointLight2d` / `SpotLight2d` / `AmbientLight2d` / `DirectionalLight2d`** — components. ✅
- **9.2 Light accumulation pass** — writes to a per-camera light texture. ✅
- **9.3 Composite pass** — multiply / add / screen the light texture over the base 2D color. ✅
- **9.4 2D shadow occluders** — line-of-sight blocking; segment- or polygon-based. ✅ (`LightOccluder2d`, segment-based)
- **9.5 Normal-map-aware 2D lighting** — optional; engine opt-in (`Light2dSettings.normalMapping`), no GPU capability needed. ✅

### Phase 10 — 3D lighting

**Status: In progress.** ADR-0044 shipped 10.1 (the three light components +
the `AmbientLight` resource) and the `GpuLights` / `prepare_lights` half of 10.3
with **simple-forward** shading (the fragment loops over all lights). ADR-0045
shipped 10.4 — directional + spot shadow maps via a shared `depth32float`
2D-array atlas (one layer per caster), a depth prepass node before the opaque
pass, and a `shadow_factor` multiply in `pbr.wgsl`. ADR-0046 shipped 10.5 —
cascaded directional shadow maps: the camera frustum is split into cascades, each
fit with a stabilized (bounding-sphere + texel-snapped) light-space projection
and stored as additional atlas layers, replacing ADR-0045's fixed origin box.
Light direction for directional/spot is derived from `GlobalTransform`.
Browser-verified in `apps/playground` (`?mode=lit`). PCF (10.6) follows; IBL
(10.7) is gated on the asset system.

- **10.1 `PointLight` / `SpotLight` / `DirectionalLight` / `AmbientLight`** — components; ambient is a resource. ✅ (ADR-0044)
- **10.2 Forward+ clustered shading** — 3D froxel grid via `ClusterConfig`. **Backlogged** (`docs/backlog/3d-clustered-forward-plus.md`): simple forward shipped in ADR-0044; clustering commits the engine to an SSBO dependency + a `storageBuffers` capability flag and is sequenced after shadows. Simple forward is the WebGL2 fallback; clustered is the WebGPU fast path.
- **10.3 `prepare_lights`** — builds `GpuLights` uniform ✅ (ADR-0044); `assign_objects_to_clusters` (the cluster-binding half) is backlogged with 10.2.
- **10.4 Shadow maps** — per-light depth render. ✅ (ADR-0045) directional + spot, 2D-array depth atlas, `NotShadowCaster` opt-out. Point-light (cube) shadows + `NotShadowReceiver` are documented follow-ons; the directional frustum was a fixed origin box until cascades (10.5, ADR-0046) added camera fitting.
- **10.5 Cascaded shadow maps** — for `DirectionalLight` via `CascadeShadowConfig`. ✅ (ADR-0046) camera-fitted cascades over the shared 2D-array atlas (`MAX_SHADOW_CASTERS` 8→12), bounding-sphere + texel-snap stabilization, per-fragment cascade selection by view-space depth in `pbr.wgsl`. Per-light split ranges, multi-camera fitting, per-cascade culling/bias are documented follow-ons.
- **10.6 PCF / shadow filtering kernels** — `ShadowFilteringMethod`.
- **10.7 Environment map & image-based lighting (IBL)** — PBR needs this to look right, but it is **gated on the asset system** (HDRI loading + cubemap baking are not built yet), so it lands after `docs/roadmap/asset-system.md`. ADR-0044's flat ambient term is the placeholder it replaces.
  - HDRI loading (`.hdr` Radiance, `.exr` OpenEXR) → high-precision float texture.
  - Equirectangular → cubemap conversion (one-shot bake).
  - Diffuse irradiance prefiltering (low-frequency cosine-weighted convolution into a small cubemap).
  - Specular GGX prefiltering (mip chain, split-sum approximation).
  - BRDF integration LUT (2D, generated once and reused).
  - `EnvironmentMapLight` component (diffuse cubemap + specular cubemap + intensity + rotation). Per-camera, with optional per-light-probe overrides.
  - `StandardMaterial` PBR shader samples it as ambient + indirect specular.
  - The same environment cubemap is the asset the **skybox** (Phase 12.7) renders — one HDRI, two consumers.
- **10.8 Light probes & `IrradianceVolume`** — placed probes for indirect lighting in regions where one global env map isn't enough. Depends on baking infrastructure.
- **10.9 Lightmap consumer** — baked lighting; the producer is a separate tool.

### Phase 11 — glTF

Primary 3D interchange format. Depends on the asset system landing first.

- **11.1 Asset loader** — `.gltf` and `.glb`.
- **11.2 `Gltf` root asset** — named scenes, nodes (`GltfNode`), meshes (`GltfMesh`), primitives (`GltfPrimitive`).
- **11.3 Material → `StandardMaterial`** — metallic-roughness, normal, emissive, occlusion, alpha mode.
- **11.4 Sub-asset labels** — `file.gltf#Scene0`, `#Mesh0/Primitive0`, etc.
- **11.5 Skins** — `GltfSkin`; skeletal mesh foundation.
- **11.6 Animations** — `AnimationClip`; depends on an animation system, which likely spawns its own roadmap.
- **11.7 `GltfExtras`** — untyped passthrough.
- **11.8 `GltfLoaderSettings`** — vertex-attribute / image-sampler / material defaults.

### Phase 12 — Post-processing & camera effects

Each effect is opt-in via a per-camera component that inserts a node into the camera's sub-graph.

- **12.1 HDR per-camera** — `Camera.hdr = true` → `Rgba16Float` main target.
- **12.2 `Tonemapping`** — None, Reinhard, ReinhardLuminance, AcesFitted, AgX, TonyMcMapface, BlenderFilmic, SomewhatBoringDisplayTransform.
- **12.3 `Msaa`** — per-camera (1 / 2 / 4 / 8).
- **12.4 `Bloom`**.
- **12.5 `Fxaa` / `Smaa`**.
- **12.6 `Taa`** — depends on motion-vector prepass + history textures.
- **12.7 `Skybox`** — visually renders the same HDRI cubemap that Phase 10.7's `EnvironmentMapLight` lights from. Single asset, two consumers. Optional per-camera rotation/intensity override.
- **12.8 Prepass** — `DepthPrepass`, `NormalPrepass`, `MotionVectorPrepass`, `DeferredPrepass`.
- **12.9 `DepthOfField`**.
- **12.10 `MotionBlur`**.
- **12.11 `ChromaticAberration`, `ContrastAdaptiveSharpening`**.
- **12.12 Order-independent transparency** — capability-gated (storage textures).

### Phase 13 — GPU-driven batching & culling

Scenes get big; CPU draws stop scaling. This phase moves the per-instance pipeline to the GPU.

- **13.1 `BatchedInstanceBuffer`** — per-instance transform + material index packed.
- **13.2 Auto-batching** — same pipeline + bind group + material → single indirect draw.
- **13.3 GPU preprocessing path** — compute shader expands transforms, does GPU frustum culling, writes `IndirectParametersBuffer`. Gated on `RendererCapabilities.computeShaders` + `indirectDraw`.
- **13.4 Two-phase GPU occlusion culling** — HZB (depth pyramid) generated from last-frame depth; cull, draw, refine.
- **13.5 `NoAutomaticBatching`** — opt-out marker for renderables that must not batch.
- **13.6 Bindless textures** — capability-gated.
- **13.7 Meshlets** — Nanite-style virtual geometry; deferred and capability-gated.

### Phase 14 — WebGL2 backend *(absorbs `webgl2-backend.md`)*

Parallel track. The capability flags from §1 are the gate; engine features that can't run on GL2 must refuse cleanly.

- **14.1 Capability inventory** — each `RendererCapabilities` flag → `true | false | emulated` on GL2.
- **14.2 Binding-model translation** — bind groups → uniform locations + texture units. Largest design surface in this phase.
- **14.3 Pipeline-model translation** — immutable WebGPU pipelines → GL program + cached state vector.
- **14.4 Shader translation** — WGSL → GLSL ES 3.00. Tint-WASM if usable, otherwise dialect-restricted hand-written shaders.
- **14.5 First render path on WebGL2** — triangle, then sprite parity with WebGPU.
- **14.6 Continuous parity tests** — golden-image diff between backends.
- **14.7 Capability-gating audit** — every engine feature that needs compute / storage textures / indirect draw refuses to run on GL2 with a clear error, not silent fallback.

### Phase 15 — Tooling & debug

- **15.1 Gizmos / debug draw** — lines, AABBs, transform axes, frustums, light cones.
- **15.2 Render statistics overlay** — draw calls, triangles, GPU time.
- **15.3 GPU timestamp queries** — capability-gated.
- **15.4 Studio render-graph visualizer**.
- **15.5 Frame capture** — export a single frame's command stream for inspection.

## Future direction / out of scope

These are real ideas; they are not phases on this roadmap.

- **FBX loader** — no first-class TS path. AssimpJS-WASM is the main candidate but perf and licensing/scope are unclear. Revisit only if the asset pipeline forces it.
- USD / Alembic interchange.
- Ray tracing — WebGPU does not yet expose RT.
- Virtual texturing.
- Volumetric lighting / fog.
- Hair / skin specialized shading.
- Particle systems — will likely spawn their own roadmap once asset + material foundations land.
- Animation graph / blend trees — will likely spawn from glTF skinning work.

## Open questions

- **Render-world implementation.** Full second `World` instance, or a logically-separate component-storage partition inside one `World`? Two-world has been chosen in principle; the *shape* is open and likely an ADR.
- **`AsBindGroup` equivalent in TypeScript.** Decorator-driven, registry-driven, or class-static schema? Bevy leans on a derive macro; we have no macros. Almost certainly an ADR.
- **WGSL → GLSL transpilation.** Ship Tint-WASM or constrain ourselves to a shader dialect we can hand-translate?
- **HDRI prefiltering (Phase 10.7).** Bake at load time on the GPU each session, or precompute and ship `.ktx2` cubemaps as part of the asset pipeline? GPU prefilter is simpler day-1; precomputed scales better for ship builds.
- **Storage-buffer dependencies.** Which engine features are willing to be GL2-incompatible? Answered phase by phase as compute/SSBO features land.
- **Animation system home.** In `engine` or a separate `@retro-engine/animation` package? Triggered by Phase 11.6.

## Links

- ADR-0001 — architecture foundations (composition-only, capability flags from day 1).
- ADR-0003 — renderer HAL.
- ADR-0008 — engine schedule, states, run conditions (`render` stage placement).
- ADR-0010 — transform and hierarchy.
- `docs/roadmap/studio-imgui.md` — editor UI on top of the engine's WebGPU canvas. Out of scope for this roadmap.
- `docs/roadmap/asset-system.md` — Phase 11 (glTF) and parts of Phase 4 (shader-as-asset), Phase 6 (mesh-as-asset), and Phase 10.7 (HDRI-as-asset) all depend on this landing.
- Bevy crates referenced for shape: `bevy_render`, `bevy_pbr`, `bevy_sprite`, `bevy_core_pipeline`, `bevy_gltf`.
