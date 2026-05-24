# ADR-0022: Shader system — `Shader`, WGSL preprocessor, `PipelineCache`, `SpecializedRenderPipelines`

- **Status:** Accepted
- **Date:** 2026-05-24

## Context

Renderer-roadmap Phase 4 is the gate between everything already shipped (HAL, render world, cameras, visibility) and the first consumer-facing draw work. Every downstream phase wants two things this phase introduces:

- **Pipeline dedup.** Today the playground triangle compiles its single pipeline once at startup and stuffs the handle in a closure. As soon as the Material system (Phase 7) lands, dozens of entities will request a pipeline that differs only by MSAA / HDR / vertex-layout / color-target format — without dedup that is dozens of redundant compilations.
- **A shader system that survives more than one file.** `VIEW_UNIFORM_WGSL` already lives at `packages/engine/src/camera/extracted.ts` as a "copy-paste this snippet into your shader" string. The TSDoc explicitly anticipates the preprocessor that this ADR ships.

Out of scope for this ADR (each documented in §"Consequences / not yet done" with its trigger):

- **`ShaderRef` (`Default | Path | Handle`)** and **hot reload** — both want the asset system, which has no timeline (`docs/roadmap/asset-system.md` is in Planning). Adding a typed handle layer ahead of the asset system would force a second refactor when the asset system lands.
- **`@group(0) = view` auto-bind / convention enforcement** — `docs/backlog/view-bind-group-zero-convention.md` already pins this to Phase 7 (Materials). Phase 4 makes the convention easier to adopt (the view module is now `#import`-able by name) but does not enforce a group index.
- **Richer preprocessor syntax** — `#import ... as alias`, selective imports, `#if <expression>`, function-like macros, recursive define expansion. None has a consumer in Phase 4–6; each is straightforward to add when one appears.

## Decision

1. **Phase 4 lives in `packages/engine/src/shader/`.** Not in `renderer-core` and not in `renderer-webgpu`. ADR-0003 fixes the HAL philosophy ("`renderer-core` exports only types and interfaces. No runtime code"); ADR-0018 line 33 explicitly anticipates that the shader system would be a layer above the HAL. The shader submodule mirrors the existing `camera/` and `visibility/` submodules — one concern per file, public surface re-exported through a submodule `index.ts`, the package root re-exports the submodule names.

2. **`Shader` is a plain value class.** `new Shader(wgslSource, { label? })`. Today the source is raw WGSL passed in at construction; once the asset system lands, `Shader` becomes a typed asset and `ShaderRef` (`Default | Path | Handle`) becomes the uniform way materials and the render graph reference shaders. The class shape — `readonly source: string` plus optional metadata — is the same in both worlds.

3. **`ShaderRegistry` is a name → raw-WGSL map.** Module-name lookup is the only `#import` resolver in Phase 4 — no filesystem paths (those want the asset system). Bevy-style double-colon namespacing is the convention (`retro_engine::view`, `my_game::shared_uniforms`); the registry treats the name as an opaque string. Inserted on the App as a single resource (resources are App-level, not per-world — see `packages/engine/src/index.ts:273`). End users / plugins call `register(name, wgsl)` at build time; the engine pre-registers `retro_engine::view` (`VIEW_UNIFORM_WGSL`) from `CameraPlugin.build`.

4. **The preprocessor is a WGSL → WGSL transform.** `preprocessWgsl(source, registry, options?) → string`. It supports a minimal C-preprocessor subset:

   - **`#import <module_name>`** inlines the registry's source at the directive line. Each module is included at most once per top-level compile (Bevy's `#pragma once` default — a second `#import` of the same module is silently elided). Cycles throw with the cycle chain in the error message.
   - **`#define NAME [value]`** seeds a substitution table. External `options.defines` (`{ HDR: true, MSAA: 4 }`) merge first; in-source `#define` may shadow. Identifier substitution is **token-aware** — `MAX_LIGHTS` defined to `16` rewrites `MAX_LIGHTS + 1` but leaves `MAX_LIGHTS_PER_FRAME` alone. External `false` is treated as "not defined" (convenient for boolean specialization keys); `true` is "defined with empty replacement". Single-pass — no recursive re-expansion.
   - **`#ifdef NAME` / `#ifndef NAME` / `#else` / `#endif`** are line-based, nestable, and propagate dead-branch state correctly into inner frames (a `#define` or `#import` inside an inactive branch is silently dropped).

   Unknown directives pass through verbatim — future WGSL extensions and backend-specific pragma-style directives are not gated.

5. **`preprocessWgsl` is named for what it is.** When the WebGL2 backend lands (roadmap §14.4), WGSL → GLSL ES 3.00 translation happens **inside `renderer-webgl2`'s `createShaderModule`**, not in the engine. Engine code always emits WGSL; users always write WGSL. The preprocessor never generalises across source languages — the engine has exactly one.

6. **`PipelineCache` is the App-wide dedupe layer.** One App resource, constructed by `ShaderPlugin` with a `Renderer` + a `ShaderRegistry` reference. Two dedupe responsibilities:

   - **`compileShader(shader, defines?)`** preprocesses the shader against the registry, hashes the resulting WGSL (FNV-1a, 32-bit, hex), and returns a cached `ShaderModule` if the hash matches; otherwise compiles through `renderer.createShaderModule` and caches the result. Identical preprocessed outputs share one module, even when the raw inputs differed.
   - **`getOrCreateRenderPipeline(descriptor)`** hashes a structural digest of the descriptor — each `ShaderModule`'s source hash (looked up via a WeakMap populated by `compileShader`), entry-point names, fragment color-target formats, primitive topology, and the identity of the `PipelineLayout` (or the literal `'auto'`). Label is intentionally not part of the key — two descriptors that differ only in label share a pipeline.

   Both caches grow without pruning today. Render-world resources persist across frames per ADR-0019, and Phase 4 has no concept of asset lifetimes — that ships with the asset system.

7. **`SpecializedRenderPipelines<Key>` is the per-pipeline-family cache.** User-instantiated and held in plugin closure or in a user-defined resource, mirroring Bevy's pattern. Generic over the consumer's `Key` type. The constructor takes the shared `PipelineCache`, a `specialize: (key: Key) => RenderPipelineDescriptor` callback, and an optional `keyToString` (default `JSON.stringify`). `get(key)` calls `specialize` once per distinct key, routes the resulting descriptor through `PipelineCache.getOrCreateRenderPipeline`, and caches the returned pipeline under the key's string. Two keys that produce the same key-string share a pipeline directly; two keys that produce structurally-identical descriptors share a pipeline through `PipelineCache`'s descriptor hash. The roadmap-mandated key contents (MSAA, HDR, vertex layout, tonemap method) are plain-data and work with the default `keyToString`; concrete key types ship with their consumers (Phase 7 materials, Phase 8 sprites, Phase 12 post effects).

8. **`ShaderPlugin` is framework-essential.** `CorePlugin` registers it immediately after `Time` and the transform-propagation hooks and immediately before `CameraPlugin`. The plugin inserts `ShaderRegistry` and `PipelineCache` on the App; `CameraPlugin`'s `build` step registers `retro_engine::view` onto the registry. Plugins are added in order and `addPlugin` calls `build` synchronously (see `packages/engine/src/plugin.ts:64`), so the ordering is straight-line code, not a schedule constraint.

Composition-only. `App` gains no new fields; `RenderContext` is unchanged; no abstract `Shader` / `Pipeline` base class; the HAL types (`ShaderModule`, `RenderPipeline`) are wrapped by the cache, not subclassed. `renderer-core` and `renderer-webgpu` are not edited by this ADR.

## Consequences

**Easier:**

- The Phase 7 material system has a turn-key shader pipeline: write WGSL with `#import retro_engine::view`, hand the `Shader` to `PipelineCache.compileShader`, build a `SpecializedRenderPipelines<MaterialKey>` keyed on the material-specific specialization (e.g. `{ msaa, hdr, tonemap, vertexLayout }`), and let the cache + specializer handle dedup across thousands of entities.
- Phase 8's `SpritePipeline` (the dedicated batched 2D path) sits naturally on top — one specializer keyed on `{ msaa, hdr, target format }` produces one pipeline per camera-target combination, shared across every sprite drawn into that combination.
- The view bind group `@group(0)` convention (deferred to Phase 7) becomes easier to land: user shaders no longer copy-paste `VIEW_UNIFORM_WGSL` — they `#import retro_engine::view`. When Phase 7 pins the convention, retrofitting consumers is a one-line directive change, not a snippet rewrite.
- The WebGL2 backend (Phase 14) is unaffected. The preprocessor outputs WGSL; `renderer-webgl2`'s future `createShaderModule` is responsible for transpiling its input to GLSL ES 3.00. The HAL boundary at `code: string` is the right seam.
- Tests for the shader system are pure unit tests (preprocessor) plus a tiny recording-renderer pattern (cache dedup) — no GPU, no integration with the App schedule.

**Harder / accepted trade-offs:**

- **Cache growth is unbounded today.** A long-running App that authors many shaders / pipelines accumulates entries until `PipelineCache.destroy()` (which doesn't exist) tears them down. Acceptable for Phase 4 — every realistic Phase 4–6 consumer touches a fixed number of pipelines. Eviction lands with the asset system, which is also when hot-reload starts requesting invalidation.
- **Error messages reference post-preprocess source.** A WGSL compile error from the backend points at the line in the preprocessed text, not at the user's original source. Acceptable until a real consumer suffers. Line-mapping back to source files (and import chains) is a future pass — likely paired with the asset system's filesystem-aware import resolver.
- **`PipelineCache.getOrCreateRenderPipeline` uses object identity for `PipelineLayout`.** Two distinct `PipelineLayout` objects with structurally-identical descriptors are treated as different keys. This is the same trade-off ADR-0018 accepted for layouts in general — layouts are typically built once at startup and held stable. Users who construct fresh layouts every frame and pass them in already break Bevy-style pipeline-layout dedup; the cache simply mirrors that.
- **`SpecializedRenderPipelines.get` returns a synchronous handle.** WebGPU supports `device.createRenderPipelineAsync`; we ship the synchronous form Phase 7 will use, accepting that pipeline compilation can hitch on first request for complex shaders. Async lands when a hitch is measured. The cache layer doesn't change shape — only the `Renderer.createRenderPipeline` call inside it.
- **No recursive define expansion.** `#define A B` followed by `#define B 5` then `A` in code substitutes to `B`, not `5`. Documented in the preprocessor's TSDoc; users who need `5` write `#define A 5` directly. The cost of fixed-point expansion (tracking cycles, re-tokenising) outweighs the benefit at the current consumer scale.

## Not yet done

Each entry below is deferred until its trigger consumer lands. None is hidden in code — the only way to find these gaps is this ADR.

- **`ShaderRef` (`Default | Path | Handle`)** and **hot reload** — both require the asset system.
- **`#import ... as alias`, selective imports** (`#import x::{a, b}`), **`#if <expr>`**, **function-like macros**, **recursive define expansion** — each becomes load-bearing only when a concrete consumer asks; adding them in isolation would be design-for-hypothetical.
- **`@group(0) = view` convention enforcement / auto-bind** — `docs/backlog/view-bind-group-zero-convention.md`. Phase 7 (Materials) pins it.
- **Compile-error pretty-printing with source mapping** — folds in with the asset-system import resolver.
- **Async pipeline creation** — `Renderer.createRenderPipelineAsync` plus a `SpecializedRenderPipelines` form that returns a promise. Lands when a measured hitch justifies it.
- **`PipelineCache` eviction / lifecycle** — ties to asset lifetimes, which means asset system first.

## Implementation

- `packages/engine/src/shader/shader.ts` — `Shader` value class.
- `packages/engine/src/shader/shader-registry.ts` — `ShaderRegistry` resource.
- `packages/engine/src/shader/preprocessor.ts` — `preprocessWgsl`, `PreprocessOptions`. Pure text-transform; no renderer dependency.
- `packages/engine/src/shader/pipeline-cache.ts` — `PipelineCache` resource (`compileShader`, `getOrCreateShaderModule`, `getOrCreateRenderPipeline`).
- `packages/engine/src/shader/specialized-render-pipeline.ts` — `SpecializedRenderPipelines<Key>`, `SpecializeFn<Key>`.
- `packages/engine/src/shader/shader-plugin.ts` — `ShaderPlugin` (inserts both resources at `build` time).
- `packages/engine/src/shader/index.ts` — submodule re-exports.
- `packages/engine/src/shader/preprocessor.test.ts` — `#import` (basic, nested, cycle, missing, single-include), `#define` (in-source, external, word-boundary, shadowing, `false`-as-undefined), `#ifdef` / `#ifndef` / `#else` / `#endif` (true, false, nested, dead-branch `#define`, malformed).
- `packages/engine/src/shader/pipeline-cache.test.ts` — shader-module dedup by preprocessed-source hash; pipeline dedup by descriptor hash; format / entry-point / layout differences invalidate; label-only differences do not.
- `packages/engine/src/shader/specialized-render-pipeline.test.ts` — key dedup, distinct-key separation, shared underlying pipeline when descriptors match across keys, custom `keyToString`.
- `packages/engine/src/core-plugin.ts` — `CorePlugin` registers `ShaderPlugin` before `CameraPlugin`.
- `packages/engine/src/camera/camera-plugin.ts` — `CameraPlugin.build` registers `retro_engine::view` onto the `ShaderRegistry`.
- `packages/engine/src/index.ts` — re-exports the shader module's public surface.
- `apps/playground/src/triangle-plugin.ts` — retrofitted to drive the chain end-to-end (`Shader` → `PipelineCache.compileShader` → `SpecializedRenderPipelines.get` → `PipelineCache.getOrCreateRenderPipeline`).
