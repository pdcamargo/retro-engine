---
'@retro-engine/ui': minor
---

feat(ui): image widget — textured UI quads (`UiImage`)

Adds the `image` minimal widget: draw a texture into a UI node's box.

- New `UiImage` component (reflection-registered: image `Handle<Image>` + `tint`
  Vec4 + source `uv` sub-rect). A node may carry both a background color and a
  `UiImage` (the image draws over the fill).
- A screen-space textured render path mirroring the MSDF text pipeline:
  `UiImagePipeline` (per-source-texture bind-group cache, `unorm8x4` tint),
  `prepareUiImages` (batch `UiImage` nodes by texture, map to clip space),
  and `makeUiImagePassNode` — wired into `UiRenderPlugin` ordered
  quad → **image** → text (images composite over backgrounds, under labels).

Additive; headless-safe (no surface → the prepare/pass no-op). Unit-tested
(`packUiImage`) + benched (`ui-image-pack`). Verified in a real browser via the
sample-game export: a 2×2 procedural checkerboard chip drew (`imageInstances === 1`),
which a solid-color quad cannot produce.
