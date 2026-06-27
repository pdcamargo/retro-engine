---
'@retro-engine/engine': patch
---

fix(engine): guard perturb_normal against degenerate UVs (NaN IBL normal)

`perturb_normal` in `pbr.wgsl` reconstructs a tangent frame from screen-space UV derivatives. On zero-area UV triangles (common where a low-poly atlas collapses a surface region to a single texel) the UV gradient is zero, so `inverseSqrt(max(dot(t,t), dot(b,b)))` returned `+inf` and `0 * inf` produced a NaN shading normal — even when no normal map is bound and the function is meant to be a no-op.

A NaN normal corrupted the image-based-lighting term (cube sampled at a garbage coordinate → a flat, constant dark texel), surfacing as sharp dark patches on atlas-textured characters under an environment map. The analytic/flat-ambient path is normal-independent, so the artifact only appeared with IBL on.

The normalizer is now clamped away from zero, so a degenerate UV gradient correctly falls back to the geometric normal. Materials with a normal map are unaffected except on the same degenerate triangles, where they now also fall back instead of producing NaN.
