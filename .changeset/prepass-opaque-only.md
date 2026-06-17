---
'@retro-engine/engine': patch
---

fix(engine): restrict the screen-space prepass to opaque materials

Alpha-masked (`alphaMode: 'mask'`) and blended (`'blend'`) materials no longer write the depth/normal/motion prepass; only opaque geometry does.

The prepass rasterises whole primitives, so an alpha-tested material wrote prepass depth for the full leaf-card geometry — including the fully-transparent texels its forward pass later discards. Because the prepass cannot reproduce the forward pass's exact per-fragment alpha coverage, those texels left depth with no shaded colour, occluding everything behind them and showing the camera's clear colour: a hole "moving with" any alpha-masked model (e.g. a glTF foliage model), cutting through the editor grid and any geometry behind it.

Opaque materials are unaffected. Alpha-masked / transparent materials establish their own depth in the forward pass (the opaque/alpha-mask phase writes depth), so they still occlude correctly — there is just no separate prepass pass for them.

Trade-off: alpha-masked materials no longer contribute to prepass-derived effects (screen-space AO occlusion, TAA motion vectors). Restoring that for alpha-tested geometry requires the prepass and forward pass to share identical per-fragment coverage and is tracked as follow-up work.

**Touched:** `MaterialPlugin.queuePrepassFromEntries` (skips entries whose `alphaMode()` is not `'opaque'`).
