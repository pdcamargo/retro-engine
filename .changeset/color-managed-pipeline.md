---
'@retro-engine/engine': minor
'@retro-engine/renderer-core': minor
'@retro-engine/renderer-webgpu': minor
---

feat(engine, renderer-core, renderer-webgpu): color-managed pipeline — sRGB swapchain + per-image color space (ADR-0049)

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
