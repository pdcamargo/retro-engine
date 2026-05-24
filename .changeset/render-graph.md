---
'@retro-engine/engine': minor
---

feat(engine): render graph — `Node` / `ViewNode` / `RenderSubGraph` / `CameraDriverNode` / default `Core2d` & `Core3d` (Renderer Phase 5)

The single hand-orchestrated per-camera loop in `App.renderFrame()` is replaced by a declarative graph. Every multi-pass feature downstream (sprite phases in §8, 2D lighting accumulate-then-composite in §9, post-processing in §12, prepasses in §12.8) plugs in as nodes inside a sub-graph instead of fighting the renderer's shape. Per ADR-0023.

**Public surface (`packages/engine/src/render-graph/`):**

- `RenderLabel` — branded string identifying a node or sub-graph; `createLabel(name)` constructor.
- `Node` / `ViewNode` — pass-shaped unit of work; `ViewNode` is a `Node` that expects `ctx.view` (one invocation per active camera). Plain-object implementations, no base class.
- `NodeRunContext` — per-invocation context; carries the App, the graph, the active encoder / pass / view, the render-set systems pre-grouped by `RenderSetName`, and the node's input slot values.
- `SlotType` (`Entity` | `TextureView` | `Buffer` | `Sampler`) + `SlotInfo` / `SlotValue` / `SlotValues` — the type system for inter-node data flow. Day-1 nodes declare empty slot lists; the type machinery is in place for §5.5 transient resources to land without graph rewrites.
- `RenderGraph` — top-level container: nodes + sub-graph registry, Kahn's topological sort, freeze-on-first-frame, throws on post-freeze mutation. Inserted as an App resource by `RenderGraphPlugin`.
- `RenderSubGraph` — flat collection of nodes + ordering edges with its own topological sort. Cannot nest.
- `CameraDriverNode` / `CameraDriverLabel` — root node; owns the per-frame encoder, iterates `SortedCameras`, dispatches each camera's sub-graph, submits.
- `MainPassNode` / `MainPassLabel` — §5.7 shim. Inside each default sub-graph, opens the camera's render pass and runs `RenderSet.Render` systems with the active `RenderContext`. Existing render-stage systems work unchanged.
- `Core2dLabel` / `Core3dLabel` + `buildCore2dSubGraph()` / `buildCore3dSubGraph()` — default sub-graph templates, each registering a single `MainPassNode` on day 1.
- `RenderGraphPlugin` — installs the resource and the default sub-graphs at `build` time. Auto-registered by `CorePlugin` after `CameraPlugin` and `VisibilityPlugin`.

**Camera surface:**

- `Camera.subGraph: RenderLabel` — new inline field, defaults to `Core2dLabel`.
- `Camera2d()` inherits the default; `Camera3d()` factory defaults to `Core3dLabel`.
- `ExtractedCamera.subGraph` and `CameraView.subGraph` mirror the field through the render-set pipeline so `CameraDriverNode` reads it off the per-frame view.

**Migration behaviour:**

- `App.renderFrame()`'s per-camera lambda is gone; the body lives in `MainPassNode`. Every observable behaviour (passes per frame, `loadOp` / `clearValue` per camera, sort order, `RenderSet.Render` system invocations, fallback clear when no cameras, headless skip) is unchanged.
- `App.runRenderSet` is now `@internal public` (was `private`) so `MainPassNode` can dispatch the render set. Downstream code outside the engine package should not call it directly.
- A camera with a `subGraph` label no plugin has registered is skipped with a one-shot `devWarn`; rendering continues for the other cameras.

**Deferred (per ADR-0023 "Not yet done"):**

- Transient resource allocator (§5.5), cross-frame history resources (§5.6), and the studio render-graph visualiser (§5.8) ship with their first consumers (bloom / post, TAA, Phase 15 respectively).
- Per-camera `ViewVisibility` (ADR-0021 open question) and `@group(0) = view` auto-bind (`docs/backlog/view-bind-group-zero-convention.md`) remain on their original triggers.
