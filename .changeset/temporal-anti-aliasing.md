---
'@retro-engine/engine': minor
---

feat(engine): Phase 12.6 — temporal anti-aliasing (`Taa`)

Per ADR-0053, adds a per-camera `Taa` component and an HDR-space resolve that jitters the camera a sub-pixel amount each frame and blends the current frame against a reprojected accumulation of previous frames — near-supersampled edges for a fraction of the cost. It is the second HDR post pass after motion blur and runs `Transparent → TAA → MotionBlur → Tonemapping`. Like motion blur it requires `Camera.hdr = true` and a `MotionVectorPrepass`; when either is missing it warns once and the camera renders without TAA rather than failing. No new HAL, no new capability flag.

Jitter is baked into the shared `view_proj` on the CPU so the depth prepass and the main pass rasterize identical geometry (a main-pass-only jitter would be rejected against the un-jittered depth buffer at silhouettes). Motion vectors stay jitter-free by reading a new `unjittered_view_proj` field. The resolve reprojects history along the motion target, clips it into the current 3×3 neighborhood's YCoCg variance box (no ghosting), and blends with Karis tonemap weighting (no HDR firefly trails).

This release also refactors the HDR post-process chain onto a shared `CurrentHdrView` handoff resource: each pass reads the latest scene view and stores its own output back, replacing the per-pass hardcoded lookups (MotionBlur and Tonemapping were moved onto it). Behaviour is unchanged for existing scenes.

**New public surface:**

- `Taa` (+ `DEFAULT_TAA`) — per-camera component with a `blend` weight.
- `TaaPlugin` — auto-installed by `CorePlugin` after `MotionBlurPlugin`; owns the jitter/param extract, the prepare system, and the Core3d graph wiring.
- `TAA_WGSL` (`retro_engine::taa`), `TaaPipeline` / `TaaKey`, `makeTaaNode` / `TaaPass3dLabel`.
- `ViewTaa` / `TaaParams`, `ViewTaaTargets` / `TaaCacheEntry`, `resolveTaaTargets` / `evictTaaTargets`, `TAA_TARGET_FORMAT`, `TAA_PARAMS_BYTE_SIZE`.
- `haltonJitter` / `TAA_JITTER_SAMPLE_COUNT` — the Halton(2,3) jitter sequence.
- `ViewJitter` / `JitterOffset` / `jitterProjection` — the camera-plugin jitter mechanism (pure, projection-agnostic).
- `CurrentHdrView` — the per-camera HDR post-process handoff resource.

**Behaviour changes:**

- The view uniform grew by one `mat4x4<f32>` (`unjittered_view_proj`): `VIEW_UNIFORM_BYTE_SIZE` is now 416 B (was 352). `view_proj` carries any active sub-pixel jitter; `unjittered_view_proj` and `prev_view_proj` are jitter-free, and `prev_view_proj` is advanced with the unjittered matrix unconditionally.
- `MotionBlur` and `Tonemapping` nodes now read their scene input from `CurrentHdrView` (falling back to the HDR intermediate) instead of hardcoding the motion-blur output lookup — output is identical, but a third post pass (TAA) now composes cleanly.
