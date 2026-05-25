# ADR-0031: `Sprite` component, `SpritePipeline`, Core2d phase trio

- **Status:** Accepted
- **Date:** 2026-05-25

## Context

Renderer Phase 7.5 ([ADR-0030](ADR-0030-image-asset-and-render-image.md)) shipped the `Image` asset, `RenderImages`, and the pre-seeded `Images.WHITE` / `BLACK` / `NORMAL_FLAT` defaults — material schemas with `imageMode: 'handle'` + `fallback: '…'` resolve `ImageHandle | undefined` fields to a real `TextureView` + `Sampler` at prepare time. Phase 7 ([ADR-0028](ADR-0028-material-system-and-core3d-phase-trio.md)) shipped `MaterialPlugin<M>`, the Core3d phase trio (`OpaquePass3dNode → TransparentPass3dNode`), per-camera depth automation via `ViewDepthCache`, and the `@group(0)` view-bind-group auto-bind convention.

The 3D path is end-to-end live. The 2D path has scaffolding but no draw:

- `Core2dLabel` and `buildCore2dSubGraph()` are wired into `RenderGraphPlugin`.
- `Camera2d()` returns `[Camera, OrthographicProjection, Transform]` with `subGraph: Core2dLabel` and `depthTarget: 'none'`.
- The Core2d sub-graph contains exactly one node — `MainPassNode`, the Phase 7 holdover that opens one pass and runs every `RenderSet.Render` system inline. Nothing pushes a 2D phase item; nothing draws sprites.

ADR-0028 §"Not yet done" and Core2d's TSDoc both name Phase 8 as the slot where the 2D phase trio displaces `MainPassNode`. This ADR does that displacement and ships the sprite hot path on top.

Bevy's 2D rendering separates batched `SpritePipeline` from arbitrary 2D geometry under `Material2d`. The sprite pipeline is its own thing because sprite batching is non-negotiable: a particle field of 10k sprites must be one or two instanced draws, not 10k.

Out of scope for this ADR (each documented in §"Not yet done" with its trigger):

- **`TextureAtlasLayout` / `TextureAtlas`** — Phase 8.2 / 8.3. `Sprite.rect` is the forward-compatible per-frame sub-rect; the atlas asset itself is a follow-up.
- **9-slice (`TextureSlicer`)** — Phase 8.5.
- **`Material2d` / `Mesh2d` / `MeshMaterial2d<M>`** — Phase 8.7. Material2d targets arbitrary 2D geometry with custom shaders, not the sprite hot path.
- **2D lighting** — Phase 9.
- **Per-sprite frustum culling** — lands with the atlas (texture dimensions become layout-stable then).
- **Sub-pixel snapping, MSDF/SDF text, GPU-driven indirect draw** — future.

## Decision

1. **Phase 8.1 lives in `packages/engine/src/sprite/`.** One concern per file (CLAUDE.md §5.5), submodule re-exports through `index.ts`, engine package root re-exports the submodule's names alongside the rest. Mirrors the established `mesh/`, `material/`, `camera/`, `image/`, `render-graph/` shape.

2. **`Sprite` is a value-class component, not an asset.** Data only:

   ```ts
   class Sprite {
     image: ImageHandle | undefined;
     color: Vec4;
     customSize: Vec2 | undefined;
     rect: Rect | undefined;
     anchor: SpriteAnchor;
     flipX: boolean;
     flipY: boolean;
     static readonly requires = [Transform, GlobalTransform, Visibility, InheritedVisibility, ViewVisibility];
   }
   ```

   `image: undefined` is preserved at the type level and resolved to `Images.WHITE` at queue time by the pipeline's bind-group resolver — `new Sprite({ color })` is a solid tint quad with no plumbing.

   `SpriteAnchor = 'center' | 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight' | { x: number; y: number }` (Bevy parity: 0..1 within the sprite's footprint). `Rect = { min: Vec2; max: Vec2 }` — a render-from sub-rect of the source image, forward-compatible with `TextureAtlas` per-frame UVs.

3. **Per-instance affine basis, not "rotation angle."** The CPU packs each sprite as a center + two basis vectors derived from `GlobalTransform.matrix`'s upper 2×2 (columns 0 and 1) and translation column. The vertex shader composes corners as `center + uv.x * basisX + uv.y * basisY`. This avoids the `Quat → 2D angle` extraction trap (the upper-left 2×2 of a column-major matrix already encodes the projected 2D affine), supports non-uniform scale + arbitrary 2D affine, and propagates parented rotations correctly.

4. **Batching key = `(ImageHandle, alphaBucket)`.** Same image + same alpha bucket = one instanced draw. `alphaBucket: 'opaque' | 'blend'` — opaque when the sprite's RGBA tint is fully opaque (`color.w === 1`); transparent otherwise. Phase 8.1 punts on per-image source-alpha analysis (would require a CPU-side image scan); a `color.w === 1` sprite using a `Images.WHITE` fallback is treated as opaque, a tinted-transparent sprite is treated as blend. This matches the source-alpha-unaware default Bevy uses for the equivalent path.

5. **Per-image `BindGroup` cached directly in `SpritePipeline.bindGroupFor(handle)` — NOT `BindGroupSchema<M>`.** Sprite has a fixed two-entry layout (one `texture_2d<f32>` + one `sampler`); schema overhead is unwarranted. The pipeline owns one cached `BindGroupLayout` for the two-entry shape, and a `Map<ImageHandle, BindGroup>` keyed by the *resolved* handle (so `undefined` and a real handle that both fall back to `Images.WHITE` share one bind group). Listens to `Modified` / `Removed` image events via the same drained queue `ImagePlugin` already publishes; invalidates the matching cache slot.

6. **Bind-group slots: `@group(0)` view, `@group(1)` sprite image, no `@group(2)`.** ADR-0028 §11 reserves `@group(0)` for the auto-bound view bind group. ADR-0028 §10 documents `@group(1)` as "per-entity transform" — that is specifically the Mesh3d convention, not a universal contract. Sprites have no per-entity transform UBO (all transform data rides the instance buffer), so `@group(1)` is the right semantic slot for sprite per-draw input. The pipeline layout is exactly two groups; no hole. Sprite WGSL declares `@group(1) @binding(0) var sprite_tex: texture_2d<f32>;` + `@group(1) @binding(1) var sprite_sampler: sampler;`.

7. **`SpriteInstanceBuffer` is owned by the sprite plugin.** `Sprite` bypasses `EntityTransformGpuCache` — one-UBO-per-entity is the wrong shape for instanced batching. The plugin owns a single growable GPU buffer (`BufferUsage.VERTEX | BufferUsage.COPY_DST`), 1.5× growth following the `MeshAllocator` precedent. Old buffers are kept alive one frame after a resize to avoid in-flight destroy validation noise. Instance data is packed into a scratch `Float32Array` and uploaded in a single `renderer.writeBuffer` call per frame.

   Per-instance layout (44 bytes, 11 f32 slots, four `@location()`s):

   - `@location(2)`: `center.xy + basisX.xy` packed as `float32x4`.
   - `@location(3)`: `basisY.xy + uvMin.xy` packed as `float32x4`.
   - `@location(4)`: `uvMax.xy` packed as `float32x2`.
   - `@location(5)`: `colorRGBA` packed as `unorm8x4` (one u32).

8. **`SpritePlugin` queue system filters cameras by `view.subGraph === Core2dLabel`.** Avoids the cross-pollination that `MaterialPlugin.queueMaterials3d` exhibits today (it iterates every camera and pushes phase items into `ViewPhases3d` keyed by 2D cameras' ids — those items never drain because the 2D sub-graph never runs the 3D phase node). A separate bug entry tracks the 3D-side fix.

9. **Sort key = camera-space Z via the view matrix, not `Transform.translation.z`.** Mirrors `MaterialPlugin.queueMaterials3d`'s computation byte-for-byte (`v[2] * wx + v[6] * wy + v[10] * wz + v[14]`). Higher Z = farther from camera = sorted earlier in the transparent pass (back-to-front). Using raw `Transform.translation.z` would break for parented sprites and for non-identity camera transforms.

10. **Core2d sub-graph rewritten to the phase trio.** `buildCore2dSubGraph()` registers `OpaquePass2dNode → TransparentPass2dNode`. Neither node attaches a depth buffer — sprites use Z-as-painter's-algorithm sort, not depth-buffer test. The nodes mirror the 3D node shape (view/encoder guards, view bind group at `@group(0)`, drain `Opaque2d` ascending + `AlphaMask2d` ascending in the opaque node, drain `Transparent2d` descending in the transparent node — `loadOp: 'load'` so the transparent pass composites onto the opaque output).

11. **`MainPassNode` stays exported but is no longer the Core2d default.** Three internal test sites (`render-world.test.ts:92,131`, `camera-render.test.ts:211`) and the unused `apps/playground/src/triangle-plugin.ts` depend on the old `MainPassNode`-in-Core2d shape. The tests migrate; the orphan playground triangle plugin migrates too (or stays — it is already not wired into `main.ts`). The `MainPassNode` symbol remains exported so a downstream consumer that wants the legacy "open a pass and run every `RenderSet.Render` system inline" shape can register it manually against a custom sub-graph.

12. **`PhaseItem2d` / `ViewPhases2d` shape mirrors the 3D twin.** `PhaseItem2d` carries `{ sourceEntity, sortDepth, draw }` identical to `PhaseItem3d`. `ViewPhases2d` holds `opaque`, `alphaMask`, `transparent` maps keyed by main-world camera entity id with the same `pushOpaque` / `pushAlphaMask` / `pushTransparent` / `clear` methods. Phase 8.1 only writes `opaque` and `transparent`; `alphaMask` is the slot for an alpha-cutoff sprite pipeline (e.g. tilemaps) and lands empty.

13. **`makeCapturingRenderer` ships in `test-utils.ts`.** The Phase 8.1 integration test needs to assert "two instanced draws against two distinct bind groups." The existing `makeRenderingRenderer` returns a no-op pass that records nothing — there is no way to make that assertion against the current renderer stub. Phase 8.1 extends `test-utils.ts` with a capturing variant whose pass methods record draw calls + bind groups + vertex/index buffer binds into a returned log. ~80 LOC; small, reusable for any future test that needs to assert "the pass ran exactly N draws."

Composition-only. The sprite system extends the engine via plugin registration. No abstract `Sprite2d` base class, no `BasePass2dNode`. The HAL is consumed through `renderer-core` types; the render graph is extended via the existing `RenderSubGraph.addNode` / `addEdge` API.

## Consequences

**Easier:**

- A particle field, bullet hell scene, or text run (once text-as-sprites lands) is one instanced draw per atlas, not one per glyph / particle. The CPU-side per-frame cost is dominated by the single `writeBuffer` per frame plus a few hundred bytes of bind-group cache.
- `new Sprite({ color })` is a usable solid-tint quad with no plumbing — `image: undefined` resolves to `Images.WHITE` at queue time, matching the ergonomics ADR-0030 set up for materials.
- The Core2d sub-graph now has the same shape as Core3d: phase items + phase nodes. Phase 12's 2D post-processing slots after `TransparentPass2dNode` the same way 3D post slots after `TransparentPass3dNode`. Future Phase 8.7's `Material2d` shares the same `ViewPhases2d` resource.
- The per-instance affine basis handles parented rotations, non-uniform scale, and arbitrary 2D affine transforms without a separate `Transform2d` component or a `Quat → angle` extraction step.

**Harder / accepted trade-offs:**

- **No per-sprite frustum culling in 8.1.** Sprites without an `Aabb` always pass the `checkVisibilitySystem` frustum test (via the `skipFrustum` short-circuit). For scenes with thousands of off-screen sprites this is wasted prepare-time work — but the cost is bounded by the prepare path's per-sprite arithmetic, not GPU. `calculateBoundsSystem` for sprites lands with Phase 8.2's atlas (texture dimensions become layout-stable then) and the cost drops to a per-frame frustum test.
- **`MainPassNode` removed from Core2d default.** Two test files and one orphaned playground plugin update. Migration is local; the affected tests update to either drive a manual sub-graph with `MainPassNode` or use the new phase trio, depending on what they were exercising. The `MainPassNode` symbol stays exported.
- **Per-image bind group, not per-batch.** Sprites that share an image share a bind group; the per-frame cost of a new image is one `createBindGroup` call. Bind-group cache invalidation on `Modified` / `Removed` image events requires the sprite plugin to subscribe to image events. The existing `RenderImages` queue does not currently expose a "what changed this frame" snapshot to downstream plugins; the sprite plugin keeps its own change-tracker by polling `ImageAssetEvent`s through a per-plugin extract system that mirrors `ImagePlugin`'s own.
- **Instance buffer destroy-on-grow needs one-frame quarantine.** WebGPU disallows destroying a buffer that is still in flight. The plugin keeps a `pendingDestroy: Buffer | undefined` slot that holds the prior frame's buffer for one frame before destroying it. Memory overhead is one extra buffer at the largest historical size; acceptable.
- **The cross-pipeline bug in `MaterialPlugin.queueMaterials3d`** (no `subGraph` filter on cameras) is not fixed here. Logged separately under `docs/bugs/material-plugin-camera-subgraph-filter.md`.
- **Source-alpha bucketing is approximated by `color.w === 1`.** A sprite with `color.w === 1` referencing a transparent image (e.g. a glyph atlas) is routed to the opaque pass and renders incorrectly. Workaround: set `color.w = 0.999`, or document that atlas-using sprites must opt in by setting alpha. The full per-image source-alpha analysis lands with the atlas asset.

## Not yet done

- **`TextureAtlasLayout` / `TextureAtlas`** — Phase 8.2 / 8.3. `Sprite.rect` is forward-compatible (an atlas asset writes per-frame `rect`s).
- **9-slice (`TextureSlicer`)** — Phase 8.5.
- **`Material2d` / `Mesh2d` / `MeshMaterial2d<M>`** — Phase 8.7.
- **2D lighting** — Phase 9.
- **Per-sprite AABB + frustum culling** — Phase 8.2 (atlas-aware).
- **Sub-pixel snapping** — UI polish, future.
- **MSDF / SDF text** — Phase 8.6 (text-as-sprites).
- **GPU-driven indirect draw for sprites** — when a measured-perf consumer asks.
- **Cross-pipeline subGraph filter in `MaterialPlugin`** — tracked separately in `docs/bugs/material-plugin-camera-subgraph-filter.md`.

## Implementation

- `packages/engine/src/sprite/sprite.ts` — `Sprite` component, `SpriteAnchor` type, `Rect` value class, `resolveAnchor` helper.
- `packages/engine/src/sprite/sprite-batch.ts` — `SpriteBatch` internal type + `packSpriteInstance` pure function.
- `packages/engine/src/sprite/sprite-instance-buffer.ts` — `SpriteInstanceBuffer` render-world resource (growable VBO + scratch + pending-destroy).
- `packages/engine/src/sprite/sprite-pipeline.ts` — `SpritePipeline` resource: quad VBO/IBO, `SpecializedRenderPipelines<SpriteKey>`, per-image bind-group cache, `bindGroupFor(handle)`.
- `packages/engine/src/sprite/sprite.wgsl.ts` — inline WGSL string `SPRITE_WGSL`; registered as `retro_engine::sprite`.
- `packages/engine/src/sprite/sprite-plugin.ts` — `SpritePlugin` (registers shader, inserts resources, registers prepare + queue systems).
- `packages/engine/src/sprite/index.ts` — public re-exports for the submodule.
- `packages/engine/src/render-graph/phase-2d.ts` — `PhaseItem2d` interface, `ViewPhases2d` resource.
- `packages/engine/src/render-graph/opaque-pass-2d-node.ts` — `OpaquePass2dNode` + `OpaquePass2dLabel`.
- `packages/engine/src/render-graph/transparent-pass-2d-node.ts` — `TransparentPass2dNode` + `TransparentPass2dLabel`.
- `packages/engine/src/render-graph/core-2d.ts` — `buildCore2dSubGraph()` rewritten to the trio.
- `packages/engine/src/render-graph/render-graph-plugin.ts` — inserts `ViewPhases2d` + a `clear` system at `RenderSet.Queue` head.
- `packages/engine/src/render-graph/index.ts` — re-export the new files.
- `packages/engine/src/index.ts` — re-exports for the sprite submodule + 2D phase types + 2D pass nodes.
- `packages/engine/src/test-utils.ts` — `makeCapturingRenderer()` helper.
- `packages/engine/src/sprite/sprite.test.ts` — unit tests (constructor defaults, anchor resolution, rect + flip UV behavior).
- `packages/engine/src/sprite/sprite-batch.test.ts` — pack-fixture test.
- `packages/engine/src/sprite/sprite-plugin.test.ts` — integration test (`makeCapturingRenderer`-based: assert two instanced draws against two distinct `@group(1)` bind groups).
- `packages/engine/src/render-graph/core-2d.test.ts` — edge order assertion for `buildCore2dSubGraph()`.
- `packages/engine/src/render-world.test.ts`, `packages/engine/src/camera/camera-render.test.ts` — migrate `MainPassNode`-dependent sites.
- `packages/engine/bench/sprite-batch.bench.ts` — "prepare 1000 sprites into 4 batches" mitata bench.
- `apps/playground/src/sprite-showcase-plugin.ts` — visual harness.
- `apps/playground/src/main.ts` — `?mode=sprites` query-string switch to swap between 3D primitives and the sprite showcase.
- `.changeset/sprite-pipeline.md` — public-surface delta (minor bump for `@retro-engine/engine`).
- `docs/bugs/material-plugin-camera-subgraph-filter.md` — known latent 3D-side bug.
