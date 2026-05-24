---
'@retro-engine/engine': minor
---

feat(engine): shader system — `Shader`, WGSL preprocessor, `PipelineCache`, `SpecializedRenderPipelines` (Renderer Phase 4)

Per ADR-0022, every `App` now runs a shader-and-pipeline dedupe layer above the HAL, plus a minimal WGSL preprocessor with `#import` / `#define` / `#ifdef`. The HAL itself (`renderer-core`, `renderer-webgpu`) is untouched.

**Shader authoring (`packages/engine/src/shader/`):**

- `Shader` — value class wrapping raw WGSL source plus an optional label. Asset-handle later (waits for the asset system); raw-source today.
- `ShaderRegistry` — App resource mapping module names (Bevy-style `crate::module`, e.g. `retro_engine::view`) to raw WGSL. Inserted by `ShaderPlugin`; `CameraPlugin.build` pre-registers `retro_engine::view` so user shaders read `VIEW_UNIFORM_WGSL` via `#import retro_engine::view` instead of copy-pasting the snippet.
- `preprocessWgsl(source, registry, options?)` — pure WGSL → WGSL transform.
  - `#import <module_name>` inlines the registry's source. Single-include per top-level compile; cycles throw with the chain.
  - `#define NAME [value]` seeds a token-aware substitution table. External `options.defines` merge first; in-source `#define` may shadow. `false` external values are treated as not-defined; `true` is defined-with-empty-replacement.
  - `#ifdef NAME` / `#ifndef NAME` / `#else` / `#endif` are line-based, nestable; `#define` / `#import` inside an inactive branch are dropped.

**Pipeline dedup (`packages/engine/src/shader/`):**

- `PipelineCache` — App resource. `compileShader(shader, defines?)` preprocesses and hashes the WGSL, returning the cached `ShaderModule` on a hit. `getOrCreateRenderPipeline(descriptor)` hashes a structural digest (shader source hash, entry points, color formats, primitive topology, `PipelineLayout` identity) and shares the compiled pipeline across identical descriptors. Label is not part of the key.
- `SpecializedRenderPipelines<Key>` — user-instantiated per pipeline family. Constructor takes the shared `PipelineCache`, a `specialize: (Key) => RenderPipelineDescriptor` callback, and an optional `keyToString` (default `JSON.stringify`). `get(key)` builds the descriptor once per distinct key string and routes it through the cache; two keys that produce structurally-identical descriptors share a pipeline via the cache's descriptor hash.

**Engine wiring:**

- `ShaderPlugin` is auto-installed by `CorePlugin` immediately before `CameraPlugin`. It inserts both resources; `CameraPlugin.build` then registers `retro_engine::view`.
- The playground triangle is retrofitted to drive the full chain: `Shader` → `PipelineCache.compileShader` → `SpecializedRenderPipelines.get` → `PipelineCache.getOrCreateRenderPipeline`. Same pixels, no visual change — the retrofit is the manual smoke witness.

**Behaviour notes / explicit non-scope:**

- `renderer-core` / `renderer-webgpu` are not edited. The HAL boundary at `Renderer.createShaderModule(code: string)` is the right seam — when the WebGL2 backend lands, WGSL → GLSL ES translation happens inside that backend, not in the engine. The preprocessor is named `preprocessWgsl` for what it is.
- `ShaderRef` (`Default | Path | Handle`) and hot reload are deferred until the asset system lands.
- Richer preprocessor syntax (`#import ... as alias`, selective imports, `#if <expr>`, function-like macros, recursive define expansion) is not in MVP — none has a consumer in Phase 4–6.
- The `@group(0) = view` convention enforcement / auto-bind stays on its backlog item (Phase 7). Phase 4 makes the convention easier to adopt — user shaders no longer copy-paste the snippet — but does not pin a group index.
- Both caches grow without pruning today. Eviction lands with the asset system, which also drives hot-reload invalidation.
