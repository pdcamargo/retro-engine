# ADR-0035: `Material2d`, `Mesh2d`, `MeshMaterial2d<M>`, Core2d AlphaMask2d slot lit, `EntityTransformGpuCache` GC contract, and Core2d back-to-front sort

- **Status:** Accepted
- **Date:** 2026-05-25

## Context

Renderer-roadmap Phase 8.7 closes the last gap on the 2D track: arbitrary geometry with shader-driven materials. ADR-0028 (Phase 7) shipped the 3D material trio (`Material` + `Mesh3d` + `MeshMaterial3d<M>` + `MaterialPlugin<M>`); ADR-0031 (Phase 8.1) shipped the Core2d sub-graph with the three-phase `ViewPhases2d` slot (`opaque` / `alphaMask` / `transparent`) but only routed sprites into `opaque` and `transparent` — `alphaMask` was reserved for "a future alpha-cutoff sprite pipeline". ADR-0032 / 0033 / 0034 fleshed out the sprite track (atlases, animations, 9-slice) but left the gap for non-sprite 2D shapes open. Phase 8.7 is "the 2D analogue of Phase 7 routed through Core2d instead of Core3d, no depth buffer."

Two latent issues surface when a second material plugin (the new `Material2dPlugin<M>`) shares infrastructure with the existing `MaterialPlugin<M>`:

1. **`EntityTransformGpuCache` GC contract is single-owner.** `gcEntityTransforms(cache, liveSet)` is called from `MaterialPlugin`'s queue closure with the *3D* live set. A second material plugin calling it with the *2D* live set evicts every 3D entry; the next frame the 3D plugin re-creates them; net effect is bounded but unnecessary buffer/bind-group churn frame-over-frame. Fixing the contract is in scope for 8.7 because 8.7 is what forces the issue.

2. **Core2d opaque sort direction is wrong without a depth buffer.** `opaque-pass-2d-node.ts` sorts `Opaque2d` and `AlphaMask2d` ascending (front-to-back) mirroring 3D, but Core2d has no depth attachment. Without depth-test, the only mechanism controlling visual order is the CPU sort, and front-to-back makes farther entities paint over nearer ones — Z-axis parallax for opaque sprites was silently wrong since ADR-0031. The fix is a two-line comparator flip plus TSDoc update; bundled into 8.7 because the new `?mode=shapes` showcase needs it to render correctly.

The Phase 8.7 deliverable boundary is "a `?mode=shapes` playground showcase renders ~20 `Mesh2d + MeshMaterial2d<ColorMaterial2d>` entities — opaque grid + blend overlays + mask disc + Z-parallax — with no engine internals required in the showcase code."

Out of scope for this ADR (each documented in §"Not yet done" with its trigger):

- **`TextureMaterial2d`** (`color × sampled image`) — niche; lands when a consumer asks. The shape mirrors `ColorMaterial2d` plus a `colorTexture: ImageHandle | undefined` field reusing `UnlitMaterial`'s `fallback: 'white'` pattern.
- **`ExtendedMaterial<Base, Extension>` for 2D** — 3D ships it for the PBR-extension case. 2D adds when a consumer needs equivalent composition.
- **`Mesh2d` batching** — Phase 13 (GPU-driven batching). Each `Mesh2d` entity is one draw call in 8.7; sprite batching is unaffected and continues to fold N sprites into one draw via the fixed-quad pipeline.
- **Sprite + Material2d shared phase items** — different pipelines, no sharing planned. Each phase item carries one pipeline's draw closure.
- **2D primitive ECS-spawn shorthand** (e.g., `new RectangleMesh2d(size, color)`) — composition over inheritance (CLAUDE.md §5.1). The pattern is `new Mesh2d(meshes.add(new Rectangle({...}).mesh().build()))` + `new plugin.MeshMaterial2d(materials.add(new ColorMaterial2d({...})))`.
- **Per-material mask threshold tuning** — single `0.5` default in 8.7. Per-material `cutoff` lands when a measured-perf consumer asks; the WGSL already reads the threshold from a uniform, so the change is "expose the field in `ColorMaterial2d`'s constructor."

## Decision

1. **Phase 8.7 lives in `packages/engine/src/material2d/`.** Sibling of `material/`, mirrors its file shape (CLAUDE.md §5.5: one concern per file, default to splitting). `Mesh2d` lives next to `Mesh3d` in `packages/engine/src/mesh/` — the mesh-handle wrapper belongs with the mesh family, not under `material2d/`. Engine package root re-exports every public symbol.

2. **`Material2d` extends `Material`.** Empty extension — the instance contract is identical to 3D, the divergence is at the static surface (`Material2dCtor<M>`'s `specialize?(d, l, key: MaterialPipelineKey2d)`). The shared instance trait keeps `Materials<M>` / `RenderMaterials<M>` reusable as type aliases (`Materials2d<M>` / `RenderMaterials2d<M>`) — no parallel registry class is needed.

3. **`MaterialPipelineKey2d` carries no depth-stencil dimensions and no vertex-layout digest.** Core2d has no depth attachment, so the key would never vary on depth format / compare / write / bias. All Phase 6 2D-eligible primitives (Rectangle / Circle / RegularPolygon — confirmed by reading `mesh/primitives/2d/`) emit the same `POSITION + NORMAL + UV_0` layout, so the digest is constant and omitted. Both fields land when a Phase 9+ 2D consumer needs the variation.

   ```ts
   interface MaterialPipelineKey2d {
     surfaceFormat: TextureFormat;
     msaaSamples: 1 | 4;
     hdr: boolean;
     alphaBucket: 'opaque' | 'mask' | 'blend';
     materialKey?: string;
   }
   ```

4. **`Mesh2d(handle)` and `MeshMaterial2d<M>(handle)` mirror the 3D ECS components.** Positional constructors, same `requires` array on `Mesh2d` (`Transform`, `GlobalTransform`, `Visibility`, `InheritedVisibility`, `ViewVisibility`). `MeshMaterial2d<M>` has no `requires` — it pairs with `Mesh2d`, an unpaired `MeshMaterial2d` is a silent no-op. Same shape as `MeshMaterial3d` from ADR-0028.

5. **`Material2dPlugin<M>` registers the per-type plumbing.** Mirrors `MaterialPlugin<M>` byte-for-byte structure: per-type subclass synthesis for `Materials2d<M>` / `RenderMaterials2d<M>` / `MeshMaterial2d<M>` via the `class extends Base` + `Object.defineProperty(name)` trick; idempotent insertion of `EntityTransformGpuCache`, `ViewPhases2d`, `MeshTransformGcPlugin`; per-type prepare + queue systems. Three deliberate divergences from 3D:

   - **Queue filters cameras by `view.subGraph === Core2dLabel`** (mirrors `sprite-plugin.ts`'s pattern). The 3D queue iterates unfiltered — out of scope to fix here.
   - **Phase routing is driven by `Material.alphaMode()`** (not by `color.w` — that's a sprite-specific heuristic). `'opaque'` → `Opaque2d`, `{kind:'mask',cutoff}` → `AlphaMask2d`, `'blend'` → `Transparent2d`. A `ColorMaterial2d` with `color.w = 0.5` and default `alphaMode: 'opaque'` renders into `Opaque2d` and the alpha channel is ignored — same semantics as `Material3d`.
   - **No depth-stencil in the pipeline descriptor.** Core2d has no depth attachment; the `RenderPipelineDescriptor.depthStencil` field is omitted unconditionally.

6. **Bind-group layout matches Material3d byte-for-byte.** `@group(0)` view (engine auto-bound), `@group(1)` per-entity transform UBO (shared `EntityTransformGpuCache`), `@group(2)` material bind group. Identical to ADR-0028 §11 so a shader author porting a Material between 2D and 3D only changes the bits that actually differ semantically — vertex math (no normal lighting), depth handling (none) — never slot numbers.

7. **`ColorMaterial2d` is the minimal Bevy parity.** Fields: `color: Vec4`, `alphaCutoff: number` (derived from `alphaMode_`), `alphaMode_: AlphaMode`. Single packed uniform binding at `@group(2) binding 0`: `color: vec4f` (16 bytes) + `alpha_cutoff: f32` (4 bytes, padded to 32). The constructor and `setAlphaMode()` keep `alphaCutoff` in sync with `alphaMode_` — direct mutation of `alphaMode_` leaves the cutoff stale.

   The discard threshold defaults to `0.5` for `alphaMode: { kind: 'mask' }` when the consumer omits an explicit `cutoff`. The WGSL reads the threshold from the uniform (uniform control flow — no per-pixel branch cost) so the path is already ready for per-material thresholds; only the default ships in 8.7.

8. **`ColorMaterial2dPlugin` registers WGSL only.** Mirrors `UnlitMaterialPlugin`'s narrow contract — the consumer adds `ColorMaterial2dPlugin` *and* `new Material2dPlugin(ColorMaterial2d)` separately. `isUnique(): false` so duplicate adds are idempotent. The registry-side check (`if (!registry.has(name))`) keeps the WGSL registration safe under repeated adds.

9. **`AlphaMask2d` slot lights up.** The Phase 8.1 reservation for "a future alpha-cutoff sprite pipeline" is now active. The first writer is `Material2dPlugin<ColorMaterial2d>` with `alphaMode: { kind: 'mask' }` — fragment shader discards every pixel where `color.a < alpha_cutoff`. Future tilemap / alpha-cutoff sprite pipelines write into the same slot.

10. **Core2d phases all sort back-to-front.** `opaque-pass-2d-node.ts` flips its `Opaque2d` and `AlphaMask2d` sort comparators from ascending (front-to-back) to descending (back-to-front), matching `Transparent2d`. Without a depth attachment the only thing controlling visual order is the CPU sort; the previous ascending order made farther entities paint over nearer ones for overlapping content (silently wrong since ADR-0031 for any opaque scene with Z layering). The opaque / alphaMask / transparent distinction in Core2d is now purely about blend state — opaque uses no blend, mask discards in the fragment, transparent uses premultiplied alpha. Sort order is the same across all three.

11. **`EntityTransformGpuCache` GC is a singleton post-queue system.** The previous contract — each queue closure calls `gcEntityTransforms(cache, liveSet)` with its own disjoint live set — breaks the moment two material plugins share the cache. Replaced with cache-owned `liveThisFrame` populated by `ensureEntityTransform` (`cache.liveThisFrame.add(entity)` at the start of every ensure) and consumed by a new `gcEntityTransformsSystem` registered in `RenderSet.PhaseSort` — strictly later than every system in `RenderSet.Queue` per the canonical `RENDER_SET_ORDER`. Single-plugin behaviour is unchanged; multi-plugin coexistence works without cache thrash. The `MeshTransformGcPlugin` is inserted idempotently by every material plugin (3D + 2D); a flag on the cache (`gcSystemRegistered`) ensures the GC system is registered once per App.

12. **Painter sort uses the full 4-term formula in `Material2dPlugin`.** Mirrors `MaterialPlugin.queueMaterials` lines 459-464:

    ```ts
    const sortDepth = v[2]*worldX + v[6]*worldY + v[10]*worldZ + v[14];
    ```

    The sprite plugin's 2-term shortcut (`v[10]*worldZ + v[14]`) is correct only for axis-aligned ortho cameras. Material2d is the more general path (custom shaders, arbitrary meshes, potentially tilted Camera2d via custom plugins); the 4-term form covers all view orientations. The 3-line computation is duplicated, not extracted — matches the precedent set by sprite-plugin and material-plugin both.

13. **`MaterialPlugin<M>` is per-type, mutually exclusive on the registry.** Re-instantiating for the same material type throws at `build()` time via the existing `Materials<M>` collision check (now identically gated on `Materials2d<M>`). Two separate material types register two plugins, each gets its own registry, no collision.

Composition-only. The 2D material system extends the engine via plugin registration. No abstract `Material2d` class beyond the empty `extends Material` marker, no `Base2dPhaseNode`, no `BaseRenderable2d`. Mesh2d / MeshMaterial2d / Material2d implementations are plain TypeScript classes with no inheritance.

## Consequences

**Easier:**

- The Phase 8.7 playground showcase reads as "spawn 22 `Mesh2d + MeshMaterial2d<ColorMaterial2d>` entities in a loop." No engine internals in the showcase code; no bind-group-layout construction, no pipeline-layout construction, no uniform packing, no shader registration. The single-screen `shapes-showcase-plugin.ts` is the boundary check for "the 2D material API is correctly scoped."
- Hollow Knight–style Z-axis parallax now works for opaque content — the Core2d sort fix removes a silent footgun. Pre-fix, parallax was only correct via `alphaMode: 'blend'` (paying alpha-blend cost for opaque layers); post-fix, opaque layers stack correctly by transform Z.
- `AlphaMask2d` slot finally fills. A 2D consumer that needs hard-edged cutout sprites (foliage, chain-link UI, retro 1-bit alpha) declares `alphaMode: { kind: 'mask' }` on a `ColorMaterial2d` (or a future textured Material2d) and gets a discard-based fragment path automatically.
- Mixed Sprite + Material2d scenes work in one camera. The sprite pipeline and the Material2d pipeline produce different phase items into the shared `ViewPhases2d`; the Core2d phase nodes drain both kinds in painter order. The mixed-scene test (`color-material-2d.test.ts`) asserts this end-to-end.
- The `EntityTransformGpuCache` GC contract is now multi-plugin-safe. Adding three or four material plugins to one App is supported; no cache thrash, no per-frame buffer/bind-group reallocation cost across plugins.
- Custom 2D materials in user code: declare a class implementing `Material2d`, write the `static bindGroup = MaterialSchema(Self, [...])`, supply a WGSL shader, register `Material2dPlugin<MyMaterial2d>`. No engine internals required; the contract is identical to 3D except the pipeline key differs.

**Harder / accepted trade-offs:**

- **Two material trait interfaces (`Material` and `Material2d`) at the type level even though they're structurally identical.** A consumer who implements `Material` could accidentally pass it to `Material2dPlugin` and vice versa; TypeScript allows it because of the structural subtype relationship. The runtime correctness is preserved (the engine doesn't switch on which trait was implemented — it uses the static surface), but the consumer's intent leaks through the static-key mismatch instead of a compile-time error. Acceptable: a strict separation (e.g., `interface Material2d` without `extends Material`) would force `Materials<M>` to become two parallel classes for no runtime benefit.
- **GC system ordering is load-bearing on `RenderSet.PhaseSort` running strictly after `RenderSet.Queue`.** Documented in `RENDER_SET_ORDER` (and unlikely to change), but any future render-set reshuffle must preserve the relationship. The `gc-entity-transforms.ts` module-level TSDoc calls this out.
- **`Material2d` and `Material3d` queue systems both `addPlugin(new MeshTransformGcPlugin())`.** Three or four material plugins add the plugin three or four times; the cache's `gcSystemRegistered` flag short-circuits all but the first. `isUnique(): false` is required because the plugin's job is dedup-at-the-cache-flag layer, not at the App-plugin layer.
- **The Core2d sort flip is a behaviour change.** Any existing user code that relied on the old front-to-back order — likely none, because the order was visually wrong — sees a different draw sequence. Mitigation: the existing sprite tests run identically (default Transform Z = 0 means no order to disturb); the change is documented in the changeset's behaviour-notes section.
- **`EntityTransformGpuCache` carries an extra `Set<Entity>` field (`liveThisFrame`).** At 1000 entities the per-frame add cost is a few hundred bytes — negligible vs. the per-entity buffer + bind-group cost the cache already carries.
- **`ColorMaterial2d` reuses the shared `EntityTransformGpuCache` 128-byte UBO** even though the 2D shader does not consume the `inverse_transpose_model` half. Wasted 64 bytes per entity uploaded per frame. At 1000 entities this is ~64 KB/frame — bounded and trivial vs. the bandwidth a single texture upload costs. A 2D-only 64-byte UBO would require a parallel cache; not justified for 8.7.
- **`MaterialPipelineKey2d.materialKey` is an opaque string contributed by `M.specialize?.()`.** Materials with multiple variants (e.g., a future Material2d with a feature flag) must format the variant into a string. Same pattern Bevy uses; documented.

## Not yet done

- **`TextureMaterial2d`** (`color × sampled image`) — lands when a consumer asks.
- **`ExtendedMaterial<Base, Extension>` for 2D** — lands alongside a consumer that needs PBR-equivalent composition for 2D.
- **`Mesh2d` GPU-driven batching** — Phase 13.
- **Per-material mask threshold tuning** — the WGSL already reads the threshold from a uniform; only the constructor surface needs to expose it. Lands when a measured-perf consumer asks.
- **Sprite + Material2d shared phase items** — different pipelines, no sharing planned. If a future tilemap or partially-batched Material2d wants to share state with sprites, it will register its own phase item shape.
- **2D primitive ECS-spawn shorthand** (`new RectangleMesh2d(size, color)`) — composition pattern preferred. The 3D primitive factories never grew this shorthand; 2D follows the same precedent.
- **4-term sort-depth extraction to a shared util** — three sites (Material3d, Material2d, sprite) inline the same formula; the 4-term version differs from sprite's 2-term shortcut. Extract when a fourth site appears.
- **Configurable cache eviction policy** — `gcEntityTransformsSystem` evicts every non-live entry every frame. A consumer that pulses entities in / out (e.g., open-world streaming) could benefit from a TTL or a high-water mark; deferred until a measured-perf consumer asks.
- **`Material2dPlugin.forSpecialized<M>`** — for per-instance pipeline variants; mirrors the 3D backlog.

## Implementation

- `packages/engine/src/material2d/material-2d.ts` — `Material2d` interface (`extends Material`), `Material2dCtor<M>` static-surface contract, `MaterialPipelineKey2d`, `alphaBucketKey`.
- `packages/engine/src/material2d/materials-2d.ts` — `Materials2d<M>` type alias of `Materials<M>` + `MaterialHandle` re-export.
- `packages/engine/src/material2d/render-materials-2d.ts` — `RenderMaterials2d<M>` type alias of `RenderMaterials<M>`.
- `packages/engine/src/material2d/mesh-material-2d.ts` — `MeshMaterial2d<M>` ECS component.
- `packages/engine/src/material2d/color-material-2d.ts` — `ColorMaterial2d` class + `ColorMaterial2dPlugin` (registers WGSL idempotently); `COLOR_MATERIAL_2D_DEFAULT_MASK_CUTOFF` constant.
- `packages/engine/src/material2d/color-material-2d.wgsl.ts` — `COLOR_MATERIAL_2D_WGSL` source.
- `packages/engine/src/material2d/material-2d-plugin.ts` — `Material2dPlugin<M>` + closure-captured `Material2dPluginState<M>` (per-type bind-group layout, shader modules, specialized pipeline cache, prepare + queue handlers).
- `packages/engine/src/material2d/index.ts` — public re-exports.
- `packages/engine/src/mesh/mesh-2d.ts` — `Mesh2d` ECS component (re-exported through `mesh/index.ts` and the engine root).
- `packages/engine/src/material/mesh-3d-transforms.ts` — `EntityTransformGpuCache.liveThisFrame` field added; `ensureEntityTransform` records liveness; `gcEntityTransforms(cache)` signature consumes liveness and clears it.
- `packages/engine/src/material/gc-entity-transforms.ts` — `MeshTransformGcPlugin` + `gcEntityTransformsSystem` (runs in `RenderSet.PhaseSort` labelled `'mesh-transform-gc'`).
- `packages/engine/src/material/material-plugin.ts` — inline `gcEntityTransforms` call removed; `MaterialPlugin.build` adds `MeshTransformGcPlugin` idempotently; `ensureEntityTransform`'s liveness recording covers the previous explicit `liveEntities.add(entity)`.
- `packages/engine/src/render-graph/opaque-pass-2d-node.ts` — sort comparators flipped to descending; TSDoc updated.
- `packages/engine/src/render-graph/phase-2d.ts` — TSDoc updated to reflect (a) `Material2d` mask mode as the first writer to `alphaMask`, (b) back-to-front sort across all three phases.
- `packages/engine/src/material/index.ts` — exports `MeshTransformGcPlugin`.
- `packages/engine/src/index.ts` — re-exports the `material2d/` surface (`Material2d`, `Material2dCtor`, `MaterialPipelineKey2d`, `Material2dPluginOptions`, `Materials2d`, `RenderMaterials2d`, `Material2dPlugin`, `MeshMaterial2d`, `ColorMaterial2d`, `ColorMaterial2dPlugin`, `COLOR_MATERIAL_2D_DEFAULT_MASK_CUTOFF`, `COLOR_MATERIAL_2D_WGSL`, `alphaBucketKey`) + `Mesh2d` + `MeshTransformGcPlugin`.
- `packages/engine/src/material2d/material-2d-plugin.test.ts` — per-type subclass synthesis, idempotent resource insertion, end-to-end frame asserts one drawIndexed in `.opaque2d`.
- `packages/engine/src/material2d/color-material-2d.test.ts` — alpha-mode bucketing matrix (opaque / opaque-with-low-alpha / blend / mask) + mixed Sprite + Material2d scene.
- `packages/engine/src/material/gc-entity-transforms.test.ts` — single-plugin cache survival across frames; entity despawn evicts; two material plugins sharing the cache do not thrash entries.
- `packages/engine/bench/material2d-prepare.bench.ts` — `ColorMaterial2d.prepareBindGroup × 1000`, `ensureEntityTransform × 1000` (cold cache). Baseline written to `packages/engine/bench/baseline.json`.
- `apps/playground/src/shapes-showcase-plugin.ts` — `?mode=shapes` showcase: 4×4 opaque grid + blend overlays + mask disc + Z-parallax sub-scene.
- `apps/playground/src/main.ts` — `?mode=shapes` route added to the URL switch.
