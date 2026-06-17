# Alpha-masked geometry in the screen-space prepass

## Status

Deferred. Alpha-masked (`alphaMode: 'mask'`) and blended materials are currently
**excluded** from the depth/normal/motion prepass (`MaterialPlugin.queuePrepassFromEntries`
skips non-opaque entries). This fixed a clear-colour occlusion hole — the prepass
wrote depth for transparent leaf-card texels the forward pass discarded — but it
means alpha-tested geometry no longer contributes to prepass-derived effects.

## What's lost

- **Screen-space AO**: foliage / alpha-tested surfaces don't occlude in SSAO (they're
  absent from the prepass depth + normal buffers SSAO reads).
- **TAA motion vectors**: alpha-tested geometry has no motion-vector prepass output, so
  TAA reprojects it as static — visible ghosting/smear on foliage while the camera (or
  the object) moves.

## Why it was excluded rather than alpha-tested in the prepass

The prepass and forward pass independently alpha-test the base-colour texture. They
must agree per-fragment, or the prepass writes depth for a texel the forward pass
discards (→ clear-colour hole). In practice they diverge:

- The forward pass samples the base colour at the implicit (auto-LOD) mip; the prepass
  fragment runs before shading and its derivatives differ, so the sampled alpha — and
  therefore the keep/discard decision — does not match the forward pass at minified
  distances and at primitive edges. Aligning both to an explicit mip-0 alpha test
  shrank the mismatch but did **not** eliminate it (a residual coverage difference
  remained that no cutoff/threshold tuning closed), which is why the material is
  excluded outright for now.

## To restore (pick one, verify zero clear-colour holes with the offscreen-hide diff)

1. **Alpha-to-coverage (MSAA)** in both passes — hardware-consistent coverage, the
   standard fix for alpha-tested foliage; removes the LOD-dependent mismatch and also
   kills the distance-thinning artifact.
2. **Shared explicit-LOD alpha test** in both passes with a proven-identical sample
   (same texture, sampler, uv, and mip selection), verified to produce byte-identical
   coverage — only viable if the residual divergence is root-caused (suspected
   prepass-vs-forward fragment/coverage difference, not yet explained).
3. **Forward-only depth for alpha-masked + a separate masked-motion/normal pass** that
   reuses the forward pass's exact coverage.

## Verification harness used to find this

A reliable check exists: render with a distinctive clear colour, hide the model
(set its root `Transform.scale` to 0) to capture the true background, and count
pixels that are clear-colour with the model present but show geometry (grid / axis
line) with it hidden. Zero such pixels ⇒ no occlusion hole. The naive
screenshot-vs-reference diff is confounded by TAA and by foliage rendering fuller —
use the hide diff.
