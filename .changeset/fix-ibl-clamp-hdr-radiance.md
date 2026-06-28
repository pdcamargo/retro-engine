---
'@retro-engine/engine': patch
---

fix(engine): clamp HDR radiance during IBL prefilter (no more Inf/NaN env patches)

The environment irradiance convolution and specular prefilter
(`environment.wgsl`) accumulated raw source-cube radiance with no upper bound.
Real HDR skies contain extreme or non-finite values — a sun disc that overflows
half-float to `+inf`, or values in the tens of thousands. Unbounded, these
corrupted the baked maps: `+inf` propagated into irradiance/specular texels, the
`radiance * cos * sin` hemisphere weighting produced `inf * 0 = NaN` at the pole,
and the tiny ultra-bright sun aliased into firefly speckle the finite sample
counts could not resolve.

Surfaces shaded by those texels showed sharp white patches (huge/`inf`
irradiance) and black patches (`NaN`) under an environment map — most visible on
low-poly characters whose flat faces each sample a distinct direction. The
skybox was unaffected because it samples the source cube directly without
convolution.

Each sampled radiance is now clamped to a finite cap before accumulation, so the
bake stays smooth and finite while preserving the sky's overall brightness.
