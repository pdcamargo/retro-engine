# ADR-0001: Architecture Foundations

- **Status:** Accepted
- **Date:** 2026-05-21

## Context

Retro Engine is a TypeScript game engine inspired by Bevy plus a Tauri + Bun + ImGui desktop studio. The codebase will host (a) hot-path engine runtime systems, (b) a hardware abstraction layer for WebGPU with a future WebGL2 fallback, (c) a plugin-driven tooling app, and (d) eventually an asset pipeline, scene system, input system, and audio system. Each of these has different ergonomic and performance constraints.

We need a single architectural posture across the project so contributors (and AI agents) make consistent choices about composition vs inheritance, module boundaries, and dependency direction. Without that posture, the codebase will accumulate inconsistent shapes that are expensive to unify later.

## Decision

1. **Composition is the default.** Inheritance is allowed when A *is a specialized version of* B and the parent's invariants must be preserved across all subclasses; otherwise compose.
2. **Per-layer guidance:**
   - `packages/ecs`, `packages/engine` (runtime/systems): composition-only. Entities are IDs; behavior is components + systems. No `GameObject`/`Entity` hierarchy.
   - `packages/renderer-core` (HAL): interfaces only. Backends conform via concrete classes; no shared abstract base.
   - `packages/assets` (when added): strategy + registry pattern. No `BaseImporter` to extend.
   - `apps/studio`: plugin-driven composition. No `EditorWindow` base class. Custom windows/dialogs register against an `EditorSDK` surface.
3. **Module boundaries.** Cross-package imports go through public `src/index.ts` only. Deep imports forbidden.
4. **Dependency direction.** `engine` depends on `ecs`, `math`, `renderer-core` — never on a concrete renderer backend. Backends are injected at `App` construction. `studio` depends on `engine` + backend(s); `engine` never depends on `studio`. `math` and `renderer-core` are leaves.
5. **Capability flags from day 1.** `renderer-core` exposes `RendererCapabilities` (compute, timestamp queries, storage textures, etc.). Engine code that needs an optional capability checks the flag and falls back. Prevents WebGL2-incompatible features from sneaking in unflagged before we even have the WebGL2 backend.
6. **`editor` is a namespace, not an app.** Future packages `editor-sdk`, `editor-runtime`, `editor-cli`. The shipping desktop app is `studio`.

## Consequences

**Easier:**
- Swapping renderer backends (WebGPU ↔ future WebGL2) is mechanical because the engine only knows the HAL.
- Adding a feature is a Plugin function, not a class-hierarchy edit.
- Studio extensions don't require us to predict every window category up front.
- Code reviews have a clear lens for the "why is this inheriting?" question.

**Harder:**
- Asking "where do I put this" up front for each feature, instead of inheriting and figuring it out later.
- The HAL interface needs to be designed and revisited before scaling renderer features; can't just bind to WebGPU directly.
- More boilerplate at the seams (factories, registration calls) than a pure OO design.

**Accepted trade-offs:**
- Slightly more upfront cost on every cross-package addition, in exchange for a codebase that stays composable as it grows past the size where any one developer holds the whole picture.

## Implementation

- `packages/ecs/src/index.ts` — `World`, `Entity`, `Component`, `Query`, `System`
- `packages/engine/src/index.ts` — `App`, `Plugin`, `Schedule`, `Stage`
- `packages/renderer-core/src/index.ts` — `Renderer`, `RendererCapabilities`, all HAL types
- `apps/studio/src/main.ts` — boots `App` with a backend chosen at startup, no concrete-backend imports in `engine`
