---
'@retro-engine/engine': minor
---

feat(engine): normal-map-aware 2D lighting — Phase 9.5

Adds per-pixel `N·L` shading for 2D sprites carrying a normal map, completing Phase 9. Per ADR-0043 (extends ADR-0037). A dedicated normal prepass captures normal-mapped sprites into a per-camera normal G-buffer, and point / spot / directional lights shade by `max(0, dot(N, L))`. The prepass route (rather than a second MRT target on the geometry passes) keeps the `Material2d` single-target contract intact and leaves accumulation running before the color geometry passes — so nothing in ADR-0037 is superseded. No GPU capability is required.

**New public surface:**

- `Sprite.normalMap?: ImageHandle` (+ `SpriteOptions.normalMap`) — optional tangent-space normal map, sampled with the sprite's UVs. No effect unless normal mapping is enabled.
- `Light2dSettings.normalMapping` (boolean, default `false`) — opt-in for normal-map shading.
- `Light2dSettings.normalLightHeight` (default `64`) — world-space height of 2D lights above the sprite plane, used as the Z of the light vector in `N·L`.
- `Light2dNormalState` — render-world resource owning the normal-capture pipeline, instance buffer, and `(enabled, height)` uniform.
- `Light2dNormalPrepass2dNode`, `Light2dNormalPrepass2dLabel` — Core2d node that captures normal-mapped sprites, ordered before the shadow + accumulation passes.
- `LIGHT2D_NORMAL_FORMAT` (`'rgba8unorm'`), `LIGHT2D_DEFAULT_LIGHT_HEIGHT` (64).

**Behaviour changes (non-breaking):**

- The Core2d sub-graph gains the normal prepass node when `Light2dPlugin` is installed. Final chain: `Light2dNormalPrepass2d → Light2dShadowPass2d → Light2dAccumulationPass2d → OpaquePass2d → TransparentPass2d → Light2dCompositePass2d`.
- `Light2dPlugin` inserts a `Light2dNormalState` resource and registers a `light2d-capture-normals` system; each Core2d camera gains a normal target + accumulation `@group(2)` bind group.
- With `normalMapping` enabled, all sprites shade by `N·L` (un-mapped surfaces use a flat normal facing the viewer); the default `false` preserves flat lighting exactly.

**Limits (v1):** sprite rotation is not applied to sampled normals; one global light height (not per-light); only sprites carry normal maps (`Material2d` / meshes do not).
