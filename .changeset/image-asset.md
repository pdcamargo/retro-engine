---
'@retro-engine/engine': minor
---

feat(engine): Image asset + handle-mode bind-group schema + StandardMaterial / UnlitMaterial default-fallback textures

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
