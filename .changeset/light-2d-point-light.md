---
'@retro-engine/engine': minor
---

feat(engine): Phase 9.1 — `PointLight2d` + accumulation/composite passes

Phase 9.1 ships the smallest viable 2D-lighting end-to-end on top of the Phase 8.x sprite + Material2d Core2d sub-graph. Per ADR-0037. A new `Light2dPlugin` restructures the per-camera 2D draw chain into base-color → accumulate → composite, and a new `PointLight2d` component contributes additive radial light into the per-camera `lightAccum` texture. The composite pass multiplies the accumulated light against the geometry's base color and writes the product into the camera's actual target.

When the plugin is **not** installed, every existing camera continues writing directly to its color target with zero behavior change — the redirect inside `OpaquePass2dNode` / `TransparentPass2dNode` falls back to `view.target.view` whenever no `ViewLight2dTargets` entry is present.

**New public surface:**

- `PointLight2d` — ECS component carrying `{ color: Vec3, intensity: number, range: number, radius: number }`. Auto-attaches the canonical `Transform + GlobalTransform + Visibility + InheritedVisibility + ViewVisibility` chain (mirrors `Sprite`).
- `PointLight2dOptions` — input shape for the constructor.
- `Light2dPlugin` — plugin owning the lighting pipeline. Registers WGSL modules, inserts resources (`Light2dPipeline`, `Light2dInstanceBuffer`, `Light2dPreparedBatches`, `ViewLight2dTargets`, `Light2dSettings`), wires two new render-graph nodes into the `Core2d` sub-graph, and registers `light2d-prepare-targets` (Prepare) + `light2d-queue` (Queue) systems.
- `Light2dSettings` — `{ ambient: Vec4; compositeMode: 'multiply' | 'add' | 'screen' }`. v1 implements only `'multiply'`; `add` and `screen` are reserved per ADR-0037 §"Not yet done".
- `Light2dCompositeMode` — string union for the field above.
- `ViewLight2dTargets` — per-camera GPU-texture cache (baseColor + lightAccum + composite bind group), keyed by main-world camera entity. Lifecycle mirrors `ViewDepthCache`.
- `Light2dCameraTargets` — one cache entry's shape.
- `Light2dPipeline` — render-world resource owning the accumulation pipeline and the surface-format-specialized composite pipeline plus the shared quad VBO/IBO and sampler.
- `Light2dCompositeKey` — specialization key for the composite pipeline (varies on `surfaceFormat`).
- `Light2dInstanceBuffer` — growable per-light VBO (mirrors `SpriteInstanceBuffer`'s 1.5× growth + one-frame quarantine pattern).
- `Light2dPreparedBatches`, `Light2dBatch` — per-camera batch records emitted by the queue system.
- `LIGHT2D_ACCUM_FORMAT` (`'rgba16float'`), `LIGHT2D_INSTANCE_BYTE_SIZE` (32), `LIGHT2D_INSTANCE_FLOAT_COUNT` (8) — instance-layout constants.
- `LIGHT2D_ACCUMULATION_WGSL`, `LIGHT2D_COMPOSITE_WGSL` — WGSL source.
- `packLightInstance`, `prepareLight2dTargets` — pure functions exposed for tests / benches / custom plugins.
- `Light2dAccumulationPass2dNode`, `Light2dAccumulationPass2dLabel`, `Light2dCompositePass2dNode`, `Light2dCompositePass2dLabel` — render-graph nodes inserted by the plugin into the `Core2d` sub-graph.

**Behaviour changes (non-breaking):**

- `OpaquePass2dNode` and `TransparentPass2dNode` now redirect their color attachment to a `ViewLight2dTargets`-backed baseColor texture when one exists. Cameras with no entry (no Light2dPlugin, or non-Core2d cameras) keep writing directly to their target view — the pre-Phase-9.1 behaviour is preserved exactly.
- The `Core2d` sub-graph gains two optional nodes when `Light2dPlugin` is added. Resulting chain for a Core2d camera with lighting installed: `Light2dAccumulationPass2d → OpaquePass2d → TransparentPass2d → Light2dCompositePass2d`.
