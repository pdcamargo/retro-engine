# ADR-0030: Image asset, RenderImage, handle-mode bind-group schema, default fallbacks

- **Status:** Accepted
- **Date:** 2026-05-24

## Context

Phase 7 (ADR-0027 / ADR-0028 / ADR-0029) shipped `UnlitMaterial`, `StandardMaterial`, and the `Core3d` phase trio. The material system specifies bind groups by **raw `TextureView` + `Sampler` fields** on the material instance — `UnlitMaterial.colorTexture: TextureView | undefined`, `StandardMaterial.baseColorTexture: TextureView | undefined`, etc. The schema walker (`prepareBindGroup`) throws when a referenced field is `undefined`, so every consumer either:

1. Hand-rolls a 1×1 white texture + linear sampler bootstrap and passes the resulting view + sampler into every material it builds; or
2. Refuses to build a material until it has *all* textures (a problem for `StandardMaterial`'s five required slots when only `baseColor` is meaningful).

The Phase 7 playground showcase (`apps/playground/src/primitives-showcase-plugin.ts`) does (1), burning ~35 LOC of texture bootstrap so its 15 unlit primitives can render. The `StandardMaterial` TSDoc explicitly flagged "A default-texture convenience helper is on the Phase 7.x slate" — this ADR lights it up.

The structural fix is Bevy's **`Image` asset**: a value class with attached `SamplerDescriptor`, registered through `Images` (mirroring `Meshes`), promoted to GPU via an `ImagePlugin` extract+prepare chain (mirroring `MeshPlugin`), and resolved at bind-group-walk time via `ImageHandle` fields on materials. Three pre-seeded defaults (`WHITE`, `BLACK`, `NORMAL_FLAT`) make `new StandardMaterial({ baseColor })` Just Work.

Phase 7.5 is the asset half of the texture story. Out of scope (each documented in §"Not yet done" with its trigger):

- **File loaders (PNG / KTX2 / etc.)** — Phase 11.5 (asset system).
- **Hot reload, async loading** — asset system.
- **Mip-chain generation** — when the first consumer with a finite filtering budget asks for it (likely lighting prefilter or texture-streaming work).
- **Compressed formats (BCn / ETC2 / ASTC)** — when a GPU compressor lands.
- **Real cube / 3D consumers** — skybox + volumetrics. The type signature supports cube + 3D `Image`s today; runtime `prepareBindGroup` throws if a material binds one until a real consumer lights up that path.
- **Per-channel samplers on `StandardMaterial`** — Phase 7.5 keeps the Phase 7 "one shared sampler" model. A consumer that needs different filtering for normal vs base colour can ask for the expansion in a future ADR.

## Decision

1. **Phase 7.5 lives in `packages/engine/src/image/`.** One concern per file (CLAUDE.md §5.5). Mirror of the established `packages/engine/src/mesh/` shape: `image.ts` + `images.ts` + `render-image.ts` + `image-plugin.ts` + `index.ts`. The engine package root re-exports the submodule's public surface alongside the rest.

2. **`Image` is a plain value class.** Fields: `data: Uint8Array`, `format: TextureFormat`, `width`, `height`, `depthOrArrayLayers` (default `1`), `dimension: '2d' | '3d' | 'cube'` (default `'2d'`), `sampler: SamplerDescriptor` (default linear / linear), `mipLevelCount: number` (default `1`), optional `label`. Static helpers: `Image.solid(rgba)`, `Image.checker(size, a, b)`, `Image.fromBytes(init)`. Pre-asset-system shape: when `@retro-engine/assets` lands, `Image` becomes a typed asset; the class shape is the same in both worlds.

3. **The class name `Image` shadows the DOM global `HTMLImageElement` constructor** in any file that imports `Image` from `@retro-engine/engine`. This is intentional for Bevy parity. The TSDoc on the class calls it out; consumers needing the DOM `Image` use `window.Image`. Engine code does not depend on `HTMLImageElement` and the studio uses Tauri, not DOM image elements — the shadow has no realistic impact today.

4. **`Images` is the pre-asset-system registry.** Main-world resource. `ImageHandle` is a branded `number`. API: `add(image): ImageHandle`, `get(handle)`, `replace(handle, image)`, `remove(handle)`, plus an internal `drainPendingChanges()` that yields `ImageAssetEvent` values for the extract system. Mirrors Bevy's `AssetEvent::{Added, Modified, Removed}`. The class is named, not generic — there is one `Image` type, no per-type subclasses.

5. **Three default handles seeded in the `Images` constructor.** `images.WHITE` (1×1 opaque white), `images.BLACK` (1×1 opaque black), `images.NORMAL_FLAT` (1×1 tangent-space identity `(0.5, 0.5, 1, 1)`). The constructor body calls `this.add(Image.solid(...))` three times; the handles are stored as readonly properties on the instance. Each default queues an `Added` event in the constructor, so the first frame's prepare pass provisions the GPU resources before any material can reference them.

6. **`RenderImage` is the GPU-side companion.** `{ texture: Texture; view: TextureView; sampler: Sampler }`. `RenderImages` (App resource) stores `Map<ImageHandle, RenderImage>` populated by `ImagePlugin`'s prepare system. The walker reads `.view` for texture bindings and `.sampler` for sampler bindings.

7. **`ImagePlugin` owns the extract+prepare pipeline.** Two App resources — `ExtractedImageAssetEvents` (queue) and `RenderImages` (map) — bridge the two stages. The prepare system is **labelled `'image-prepare'`** so `MaterialPlugin<M>`'s prepare system (which reads `RenderImages`) declares `after: ['image-prepare']` and the GPU resources exist before any handle resolves.

8. **`mipLevelCount > 1` throws.** The field stays on `Image` so a future phase adds multi-mip uploads without breaking type compatibility. The three default Images are 1×1 so the happy path is unaffected.

9. **Cube / 3D images throw at material-binding time.** `Image.fromBytes` accepts `dimension: 'cube' | '3d'` (with `depthOrArrayLayers === 6` for cube), and `ImagePlugin.prepare` correctly uploads them to the GPU. But `prepareBindGroup`'s handle-mode resolver throws with a "Phase 7.5: cube/3D consumers not lit up yet" message when a material binds one. The first real consumer (skybox material, volumetric lighting) removes that throw alongside its own binding shape.

10. **`BindGroupEntry<M>`'s texture and sampler variants split on `imageMode`.** Two flavours of each kind:
    - **`imageMode: 'handle'`** (texture or sampler) — `fieldKey` points at an `ImageHandle | undefined` field; required `fallback: 'white' | 'black' | 'normalFlat'` names the default the walker resolves to when the field is `undefined`. The sampler-mode-handle entry uses the **same** `fieldKey` as the matching texture entry so a single `Image`'s sampler binds at both slots. This is the new ergonomic surface.
    - **`imageMode: 'view'`** (texture) / **`imageMode: 'sampler'`** (sampler) — `fieldKey` points at a raw `TextureView | undefined` / `Sampler | undefined`; the walker throws on `undefined`. This is the escape hatch for the rare advanced case (e.g. presenting a render-pass output as a material binding).

11. **`prepareBindGroup`'s signature gains `images: Images` and `renderImages: RenderImages` parameters.** They're threaded through `MaterialPlugin<M>.prepareMaterials`, which adds `Res(Images)` and `Res(RenderImages)` to its prepare-system params. The walker resolves handle-mode entries via `renderImages.get(handle)`, falling back through `images.WHITE` / `.BLACK` / `.NORMAL_FLAT` per the entry's `fallback`.

12. **`StandardMaterial`'s binding-2 sampler resolves through `baseColorTexture`.** All five PBR taps (binding 1, 3, 4, 5, 6) sample through the single sampler at binding 2. WGSL (`pbr.wgsl`) is unchanged. The schema's sampler entry shares its `fieldKey` with the binding-1 texture entry — i.e. the sampler comes from whichever `Image` is bound at binding 1 (or `Images.WHITE` when undefined). Per-channel sampling control (one sampler per texture) is a future expansion.

13. **`StandardMaterial`'s five texture fields are `ImageHandle | undefined`.** Per-entry fallbacks: `baseColorTexture`, `metallicRoughnessTexture`, `emissiveTexture`, `occlusionTexture` → `Images.WHITE`; `normalMapTexture` → `Images.NORMAL_FLAT`. `new StandardMaterial({ baseColor })` produces a usable PBR material with no manual texture authoring.

14. **`UnlitMaterial.colorSampler` is removed.** `colorTexture` becomes `ImageHandle | undefined`. Both the binding-1 texture entry and the binding-2 sampler entry declare `imageMode: 'handle'`, `fieldKey: 'colorTexture'`, `fallback: 'white'`. `new UnlitMaterial({ color })` produces a usable tint-only material with no plumbing.

15. **`ImagePlugin` is engine-internal and registered by `CorePlugin` alongside `MeshPlugin`.** Both data-layer plugins live next to each other in the engine's plugin list. This makes the `MaterialPlugin<M>.prepare` system's `after: ['image-prepare']` constraint resolvable for every user-instantiated material plugin — they all inherit a registration-order setup where the label is already in scope.

Composition-only. `App` gains no new fields; `RenderContext` is unchanged; no abstract `Image` / `RenderImage` base class.

## Consequences

**Easier:**

- `new StandardMaterial({ baseColor })` and `new UnlitMaterial({ color })` Just Work — no white-texture / linear-sampler bootstrap, no required field plumbing.
- The Phase 7 playground showcase loses its ~35-LOC bootstrap; the spawn loop reads as "mesh + material + transform" with no texture plumbing.
- Material authors register an `Image` once and reference it by handle from any number of materials — the handle indirection means no allocator-level coordination at use sites.
- The asset-system migration (Phase 11.5) folds `Image` + `Images` + `ImageHandle` into typed assets without source-level changes to user code; the shape is structurally compatible.
- The handle-mode escape hatch (`imageMode: 'view'` / `'sampler'`) is preserved verbatim — a render-graph node that wants to bind its output as a material texture writes the raw view directly without going through the asset system.

**Harder / accepted trade-offs:**

- **Breaking change to `UnlitMaterial` and `StandardMaterial`.** Their texture / sampler field shapes changed (`TextureView` → `ImageHandle`, `colorSampler` and `materialSampler` removed). Phase 7's pre-release consumers (the playground showcase + the engine's own tests) migrate in this PR. Phase 7 wasn't published, so no external consumer breaks.
- **`StandardMaterial`'s binding-2 sampler is now sourced from `baseColorTexture`'s Image.** Authors who want different filtering for normal-map sampling can't get it under the Phase 7.5 schema. The expansion path is documented (Decision §12, "Not yet done") and structurally additive.
- **The `Image` class name shadows `HTMLImageElement`.** A small footgun for engine devs reaching for the DOM constructor in a file that imports our `Image`. Worth it for Bevy parity; the TSDoc warns explicitly.
- **Cube / 3D images are runtime-trapped.** Authoring + uploading works; binding through a Phase 7.5 material throws. The trap is precise — the error names the dimension and points at the missing-consumer story — but it's still a runtime trap rather than a compile-time one.
- **`mipLevelCount > 1` throws.** Users who need pre-baked mips have to wait for the next phase. Documented at the throw site.
- **The schema-walker call path is one more parameter wider.** `prepareBindGroup` now takes `images` and `renderImages` arguments. Internal callers (only `MaterialPlugin.prepareMaterials` and tests) update accordingly.
- **The default `Images` instance allocates 3 textures the user may never reference.** A 1×1 RGBA8 texture is 4 bytes — the three defaults together are 12 bytes of CPU data plus three small GPU textures. Negligible overhead for the ergonomic win.

## Not yet done

Each entry below is deferred until its trigger consumer lands.

- **File loaders (PNG / KTX2 / etc.)** — Phase 11.5 (asset system).
- **Hot reload, async loading** — Phase 11.5.
- **Mip-chain generation** — when the first consumer asks. The `mipLevelCount` field is reserved.
- **User-supplied multi-mip uploads** — when a consumer ships pre-baked mips.
- **Compressed formats (BCn / ETC2 / ASTC)** — when a GPU compressor lands.
- **Real cube / 3D consumers (skybox, volumetrics)** — alongside their first binding shape.
- **Per-channel samplers on `StandardMaterial`** — Phase 7.x expansion or later. Today's sampler-of-primary rule is documented in §12.
- **Asset-system `Handle<Image>` migration** — when `@retro-engine/assets` lands.

## Implementation

- `packages/engine/src/image/image.ts` — `Image` value class, `Image.solid` / `.checker` / `.fromBytes`, `bytesPerTexel`, `ImageDimension`.
- `packages/engine/src/image/images.ts` — `Images` registry, `ImageHandle`, `ImageAssetEvent`, the three `WHITE` / `BLACK` / `NORMAL_FLAT` default handles.
- `packages/engine/src/image/render-image.ts` — `RenderImage` interface.
- `packages/engine/src/image/image-plugin.ts` — `ImagePlugin`, `ExtractedImageAssetEvents`, `RenderImages`, the labelled `'image-prepare'` prepare system.
- `packages/engine/src/image/index.ts` — module re-exports.
- `packages/engine/src/image/{image,images,image-plugin}.test.ts` — unit + integration tests for the image asset surface.
- `packages/engine/src/material/bind-group-schema.ts` — `ImageFallback` named-default union; `BindGroupEntry<M>`'s `texture` and `sampler` variants split on `imageMode`.
- `packages/engine/src/material/prepare-bind-group.ts` — `prepareBindGroup` signature gains `images: Images` and `renderImages: RenderImages`; handle-mode resolution with per-entry fallback; cube / 3D throw.
- `packages/engine/src/material/material-plugin.ts` — prepare-system params gain `Res(Images)` + `Res(RenderImages)`; registration gains `after: ['image-prepare']`; `prepareMaterials` threads both through to the walker.
- `packages/engine/src/material/unlit-material.ts` — drop `colorSampler`; `colorTexture` becomes `ImageHandle | undefined`; schema rewrite (handle-mode entries with `fallback: 'white'`).
- `packages/engine/src/material/standard-material.ts` — drop `materialSampler`; five texture fields become `ImageHandle | undefined`; schema rewrite (handle-mode entries with per-slot fallbacks).
- `packages/engine/src/material/bind-group-schema.test.ts` — `FakeMaterial` migrates to `imageMode: 'view'`; new `HandleMaterial` covers handle resolution + fallback + cube-rejection.
- `packages/engine/src/material/material-plugin.test.ts` — end-to-end frame drives a material with no texture fields (fallback path).
- `packages/engine/src/material/playground-repro.test.ts` — adds the canonical "PBR with only `baseColor`" default-fallback frame test.
- `packages/engine/src/material/extended-material.test.ts` — migrates the `UnlitMaterial` instantiation to drop texture fields.
- `packages/engine/src/core-plugin.ts` — `CorePlugin` registers `ImagePlugin` alongside `MeshPlugin`.
- `packages/engine/src/index.ts` — re-exports the image module's public surface (`Image`, `Images`, `ImageHandle`, etc.) and the new `ImageFallback` from `./material`.
- `packages/engine/src/material/index.ts` — re-exports `ImageFallback`.
- `packages/engine/src/test-utils.ts` — `makeRenderingRenderer`'s `writeTexture` becomes a no-op (used by `ImagePlugin`'s prepare path).
- `packages/engine/bench/prepare-bind-group.bench.ts` — handle-mode walker benchmark (all fields set vs all fallbacks).
- `apps/playground/src/primitives-showcase-plugin.ts` — drops the white-1×1 + linear-sampler bootstrap; materials carry only a `color`.
