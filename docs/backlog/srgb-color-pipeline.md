# sRGB-aware color pipeline (swapchain + image upload)

- **Created:** 2026-05-28

## Context

The engine renders without an explicit sRGB pipeline. Two related gaps,
both pre-existing, became visible when ADR-0048 shipped tonemapping —
the tonemap operators assume a color-managed output, and rendering them
against the current pipeline produces visibly dim images.

- **Swapchain.** `packages/renderer-webgpu/src/index.ts` returns
  `navigator.gpu.getPreferredCanvasFormat()` (typically `'bgra8unorm'`)
  from `getPreferredSurfaceFormat()`, and `App.initSurface()` configures
  the canvas with that format directly. No `viewFormats` enables an
  sRGB-encoding view, and `Surface.getCurrentTextureView()` does not
  create a `-srgb` view. The engine writes linear values straight to the
  swapchain; the display gamma then darkens them, so all rendered output
  is ~2.2× too dark perceptually.
- **Image upload.** `packages/engine/src/image/image.ts` defaults uploaded
  images to `'rgba8unorm'` — sampled bytes pass through as linear
  values, never sRGB-decoded. An sRGB-encoded PNG byte of 128 reaches
  the shader as ~0.5 linear when it should be ~0.22. Lighting math runs
  on values too bright by the same ~2.2 factor.

The two errors **cancel** for image-based content — sprite scenes look
roughly correct because the image's over-brightness compensates for the
swapchain's under-display. For shader-only content (PBR / lit scenes
with no textures, e.g. the `?mode=lit` showcase) only the swapchain side
is wrong, so the scene renders too dark — most visible under the
tonemap path that ADR-0048 added (the tonemap curves assume a
color-managed output and "expose" the engine's missing gamma).

ADR-0048's `AgX` shader (`packages/engine/src/tonemapping/tonemapping.wgsl.ts`)
originally carried a `pow(., 2.2)` step copied verbatim from three.js's
reference implementation — that step assumes an sRGB-aware swapchain
and would double-encode on the current pipeline. The line was removed
at ship time with a comment pointing at this backlog file; restoring it
(or equivalent linearisation) is part of the work that lands here.

## Why deferred

- Real surface area. Fixing this correctly is **not** a one-line
  swapchain flip — it requires both sides moving together (swapchain
  sRGB encode AND per-image sRGB-vs-linear flag on the asset, with the
  upload format following the flag), so a normal-map texture still
  uploads as `'rgba8unorm'` while a color texture uploads as
  `'rgba8unorm-srgb'`.
- Every shipped showcase (`apps/playground/src/*-showcase-plugin.ts`) is
  implicitly tuned for the broken-gamma pipeline. After the fix, light
  intensities, base colors, and ambient brightness will all need
  re-tuning — that's iterative visual work driven by the project owner,
  not a mechanical port.
- This is its own architectural decision. The Image asset gains a
  public field, the renderer HAL's surface contract changes, and the
  shipped visual identity of every demo shifts. That warrants its own
  focused ADR + PR rather than a side-effect of the HDR slice.

## Acceptance

- A new ADR (ADR-0049 or later) seals the color-managed pipeline:
  - `Renderer.getPreferredSurfaceFormat()` / `Surface.configure()` /
    `Surface.getCurrentTextureView()` thread `viewFormats` and create
    sRGB views so hardware encodes on store.
  - `Image` gains a `colorSpace: 'srgb' | 'linear'` field (Bevy-shape)
    defaulting to `'srgb'` for color textures; `RenderImage` picks the
    matching `-srgb` upload format. `Image.WHITE` and other engine
    defaults pick the right space explicitly.
  - The Material2d / Sprite / PBR shader sampling paths see correctly
    decoded linear values.
  - Tonemap operators that assume linear-output-into-sRGB-encoder
    (currently: the perceptual-AgX stops being a special case;
    Reinhard / ACES / Filmic / SBDT render at intended brightness).
  - AgX shader regains its `pow(., 2.2)` (or proper sRGB OETF inverse)
    output step. Comment in `tonemapping.wgsl.ts` is updated.
- Every playground showcase is re-tuned and signed off visually by the
  project owner; the lit, lights, sprites, atlas, slice, primitives,
  shapes, and triangle demos all look correct under the new pipeline.
- This backlog file is deleted by the user.
