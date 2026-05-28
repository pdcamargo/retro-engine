# ADR-0049: color-managed pipeline — sRGB swapchain + per-image color space

- **Status:** Accepted
- **Date:** 2026-05-28

## Context

The engine has shipped through Phase 12 without an explicit color-managed
path. Two pre-existing gaps cancel for image-heavy 2D scenes and bite for
shader-only content. ADR-0048 (HDR + tonemapping) made the gap visible: the
tonemap operators ship in this broken regime, so the most visible artifact is
that scenes rendered with the new `AgX` / `ACES` / `Reinhard` / `BlenderFilmic`
/ `SBDT` curves look ~2.2× too dim under `?mode=lit`.

- **Swapchain.** `Renderer.getPreferredSurfaceFormat()`
  (`packages/renderer-webgpu/src/index.ts:94`) returns
  `navigator.gpu.getPreferredCanvasFormat()` (typically `'bgra8unorm'`) and
  `Surface.configure()` (`packages/renderer-webgpu/src/surface.ts:19`) passes
  that format straight to `context.configure({ format })`. No `viewFormats` is
  registered, and `getCurrentTextureView()` creates a default view in the
  storage format. Pipelines declare the same format in
  `fragment.targets[].format`, so the GPU writes linear shader output into a
  non-sRGB swapchain — the display gamma then darkens it.
- **Image upload.** `packages/engine/src/image/image-plugin.ts:171` calls
  `renderer.createTexture({ format: image.format })` with no sRGB-decode
  signal. PNG-style sRGB bytes pass through as linear values, never decoded.
  An sRGB byte of `128` reaches the shader as `~0.5` linear when it should be
  `~0.22`.

For image-driven 2D content the two errors cancel — image over-brightness
compensates for swapchain under-display. For shader-only content (3D PBR,
`Material2d` color grids, primitives) only the swapchain side is wrong.
ADR-0048's `fs_agx` originally carried a `pow(., 2.2)` linearisation step
copied from the three.js port; it was removed at ship time
(`packages/engine/src/tonemapping/tonemapping.wgsl.ts:159-164`) with a comment
pointing at this slice — the AgX curve outputs display-encoded values, so
without an sRGB-encoding view to undo the inverse OETF it double-encodes.

This ADR closes the gap as a single coherent change: the swapchain encodes
sRGB on store, the `Image` asset carries a color-space tag and uploads to the
matching GPU format, and `fs_agx` linearises before return so the encode
round-trips correctly. Every shipped showcase gets visually re-tuned by the
project owner.

## Decision

1. **The swapchain configures an sRGB-encoding view alongside its base
   storage format.** Three format roles exist; the ADR pins one source of
   truth per role:

   | role | who consumes it | value |
   |---|---|---|
   | **storage format** | `context.configure({ format })` | the canvas's preferred storage format (`'bgra8unorm'` typically) |
   | **view format** | `texture.createView({ format })` + pipelines' `fragment.targets[].format` | the `-srgb` variant of storage; hardware does linear → sRGB on store |
   | **preferred surface format** | `Renderer.getPreferredSurfaceFormat()` | the **storage** format (unchanged) |

   `Surface.configure({ format })` accepts the storage format and internally
   registers `viewFormats: [srgbVariantOf(format)]` with the GPUCanvasContext.
   `Surface.format` (and the `ResolvedRenderTarget.format` exposed via
   `RenderCtx.camera.mainColorTarget`) returns the **view** format, so
   pipelines pick up the srgb variant by reading the value they already read.
   `Surface.getCurrentTextureView()` creates the view with the srgb format
   explicitly. No per-pipeline color-target string changes required (one
   exception: `apps/playground/src/triangle-plugin.ts` previously read
   `app.renderer.getPreferredSurfaceFormat()` directly and now reads from
   `RenderCtx.camera.mainColorTarget.format`).

2. **`Image` gains a `colorSpace: 'srgb' | 'linear'` field.** Defaults to
   `'srgb'` from every factory (`Image.solid`, `Image.checker`,
   `Image.fromBytes`) — the common authored case is a color texture.
   `Image.format` stays the base GPU format (no `-srgb`); the upload layer
   picks `srgbVariantOf(image.format)` when `colorSpace === 'srgb'`. Data
   textures (normal maps, metallic / roughness / AO, displacement,
   atlas-layout LUTs) must opt out with `colorSpace: 'linear'`. The factory
   methods take a slim options bag (`{ sampler?, label?, colorSpace? }`) so
   the field is reachable without a fourth positional arg; this replaces the
   previous `(rgba, sampler?, label?)` / `(size, a, b, sampler?, label?)`
   positional signatures.

3. **Engine-provided default handles pick a color space explicitly.**
   `Image.WHITE` and `Image.BLACK` seed as `'srgb'`; `Image.NORMAL_FLAT` seeds
   as `'linear'`. The WHITE / BLACK choice is safe under StandardMaterial's
   multi-purpose fallback (color and data slots both reach for WHITE) because
   `0.0` and `1.0` are bit-invariant under sRGB ↔ linear decode. NORMAL_FLAT
   must be linear: the literal `(0.5, 0.5, 1, 1)` sRGB-decodes to
   `~(0.214, 0.214, 1, 1)`, which would corrupt tangent-space normal
   sampling.

4. **Tonemap operators whose curve fuses the display transform with the
   tonemap apply the inverse sRGB OETF before return.** Two operators in
   the LUT-free set are display-encoded by construction: `fs_agx` (the
   polynomial AgX fit lands in display-encoded sRGB) and
   `fs_blender_filmic` (the Hejl-Burgess-Dawson curve bakes the 2.2 OETF
   into the tonemap). Both now apply the piecewise sRGB inverse OETF (a new
   `srgb_to_linear` helper at the top of `tonemapping.wgsl.ts` alongside
   `luminance`) so the swapchain view's sRGB OETF re-encodes the
   operator-intended display value bit-for-bit. The remaining operators
   (`None`, `Reinhard`, `ReinhardLuminance`, `ACES`, `SBDT`) output linear
   already — no shader change, but their visible brightness lifts because
   the swapchain view now applies the sRGB encode they were silently
   missing.

## Consequences

- **Every shipped showcase changes brightness.** All `apps/playground/src/*-showcase-plugin.ts`
  were implicitly tuned for the broken-gamma pipeline. Each scene needs a
  visual re-tune by the project owner — light intensities, ambient
  brightness, base colors, clear colors. The verification slice walks
  `?mode=` paths in the browser with the owner's eyes; sign-off is not
  delegable.
- **Consumers writing data textures must pass `colorSpace: 'linear'`
  explicitly.** Normal maps, metal/rough/AO maps, displacement, atlas-layout
  LUTs. The default is `'srgb'` (the common case); the failure mode for the
  data case is silent sample corruption, not a runtime error.
- **`renderer-core`'s `TextureFormat` union gains two members.** Backends
  must accept `'rgba8unorm-srgb'` and `'bgra8unorm-srgb'` for `createTexture`
  / view creation / pipeline target declaration. The WebGPU backend passes
  them through verbatim; the future WebGL2 backend (ADR-0001 §5.2) will
  translate them to its internal `GL_SRGB8_ALPHA8` + `GL_FRAMEBUFFER_SRGB`
  pair.
- **`Image.solid` / `Image.checker` constructor shape changes.** Old
  `Image.solid(rgba, undefined, 'label')` / `Image.checker(size, a, b, undefined, 'label')`
  positional forms become `Image.solid(rgba, { label: 'label' })` /
  `Image.checker(size, a, b, { label: 'label' })`. Mechanical conversion of
  ~20 call sites in tests + showcases.
- **`bytesPerTexel()` reports `4` for the new `-srgb` variants.** Same width
  as the base form — the difference is the transfer function, not the
  storage layout.
- **No render-graph or pass-node change.** Every pass already reads
  `view.mainColorTarget.format` and feeds it into pipeline specialization
  (ADR-0048 §4 wired this for the HDR slice); pipelines pick up the srgb
  variant automatically once `Surface.format` returns it.

## Implementation

- `packages/renderer-core/src/formats.ts` — `TextureFormat` adds
  `'rgba8unorm-srgb'` / `'bgra8unorm-srgb'`. New `srgbVariantOf()` helper.
- `packages/renderer-core/src/index.ts` — re-exports `srgbVariantOf`.
- `packages/renderer-webgpu/src/surface.ts` — `makeSurface()`: registers
  `viewFormats`, stores the view format, `format` getter returns it,
  `getCurrentTextureView()` creates the view with the srgb format.
- `packages/renderer-webgpu/src/surface.test.ts` — new. Mocks
  `canvas.getContext('webgpu')` and asserts the storage → view mapping for
  `bgra8unorm` and `rgba8unorm`.
- `packages/engine/src/image/image.ts` — `Image.colorSpace` field
  (`'srgb' | 'linear'`), factories rewritten to options-bag form,
  `bytesPerTexel()` extended for `-srgb` variants, `Image.fromBytes()`
  rejects explicit `-srgb` formats with a route-through-`colorSpace` error.
- `packages/engine/src/image/images.ts` — `Image.WHITE` / `BLACK` seed as
  `'srgb'`; `NORMAL_FLAT` seeds as `'linear'`.
- `packages/engine/src/image/image-plugin.ts` — `uploadImage()` picks
  `srgbVariantOf(image.format)` when `colorSpace === 'srgb'`.
- `packages/engine/src/image/image.test.ts` — extends coverage of factory
  defaults, propagation, `WHITE` / `BLACK` / `NORMAL_FLAT` regression guard,
  `-srgb` rejection, `bytesPerTexel` for the new variants.
- `packages/engine/src/tonemapping/tonemapping.wgsl.ts` — adds
  `srgb_to_linear()` next to `luminance()`; `fs_agx` applies it before
  return; top-level docstring rewritten.
- `apps/playground/src/triangle-plugin.ts` — reads view format from
  `RenderCtx.camera.mainColorTarget.format` instead of
  `app.renderer.getPreferredSurfaceFormat()`.
- All callers of the old positional `Image.solid` / `Image.checker` form
  (tests + showcases) updated to options-bag.
- `apps/playground/src/*-showcase-plugin.ts` — light intensities / ambient /
  base colors / clear colors re-tuned visually by the project owner.
