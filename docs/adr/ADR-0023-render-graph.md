# ADR-0023: Render graph — `Node`, `ViewNode`, `RenderSubGraph`, `RenderLabel`, `CameraDriverNode`, default `Core2d` / `Core3d`

- **Status:** Accepted
- **Date:** 2026-05-24

## Context

Renderer-roadmap Phase 5 is the gate that turns the renderer from one hand-orchestrated pass into a topology of declarative nodes. Every multi-pass feature downstream wants this graph in place before it can land:

- Phase 8's sprite phases (`Opaque2d`, `AlphaMask2d`, `Transparent2d`) need a place to live inside the per-camera body.
- Phase 9's 2D lighting wants the accumulate-then-composite pattern as sequential nodes.
- Phase 12's post-processing (tonemap, bloom, FXAA, TAA) plugs in after the main pass.
- Phase 12.8's prepasses (depth, normal, motion-vector, deferred) plug in before it.

ADR-0019 and ADR-0020 both promised "no restructuring" when Phase 5 lands:

- ADR-0019: *"No restructuring needed when the render graph (Phase 5) lands; the graph absorbs the inside of the `Render` set and the surrounding sets stay unchanged."*
- ADR-0020: *"Phase 5 (render graph) absorbs the per-camera loop body without restructuring: the current 'open pass → run Render set → end pass' lambda becomes the `CameraDriverNode`, and individual draw phases become graph nodes inside it."*

The lambda in question lived at `packages/engine/src/index.ts:1075–1097` — twenty lines of "iterate `SortedCameras`, build a `ColorAttachment` from each camera's target / loadOp / clearColor, `beginRenderPass`, run `RenderSet.Render` systems with a `RenderContext`, `pass.end()`." This ADR moves that lambda into a graph node and registers a declarative topology around it.

Out of scope for this ADR (each documented in §"Not yet done" with its trigger):

- **Transient resource allocator** (roadmap §5.5). Intra-frame texture/buffer allocation with aliasing — bloom, post-processing, and 2D lighting accumulate-then-composite are the first consumers, all in later phases.
- **Cross-frame history resources** (roadmap §5.6). TAA and other temporal effects need history textures; this ships with Phase 12.6.
- **Studio render-graph visualiser** (roadmap §5.8). Deferred to Phase 15.
- **Per-camera `ViewVisibility`** (ADR-0021's open question). The current aggregate-boolean `ViewVisibility.visible` works for Phase 5 — multi-pass scenes that want per-camera visibility wait for a consumer that suffers from the limitation, at which point the slot system on this graph is the natural carrier.

## Decision

1. **The graph lives in `packages/engine/src/render-graph/`.** Not in `renderer-core` and not in `renderer-webgpu` — the graph is engine-level orchestration over the backend-agnostic HAL, mirroring the placement of `camera/`, `visibility/`, and `shader/`. One concern per file (CLAUDE.md §5.5); the submodule re-exports through its own `index.ts`, and the engine package root re-exports the submodule names alongside the rest of the public surface.

2. **`RenderLabel` is a branded string.** `type RenderLabel = string & { readonly __renderLabel: unique symbol }` with a single `createLabel(name: string): RenderLabel` constructor. Built-in labels — `Core2dLabel`, `Core3dLabel`, `CameraDriverLabel`, `MainPassLabel` — are exported `as const` from their owning files. Plugins create their own via `createLabel('my_plugin::my_node')`. The brand prevents accidental coercion from arbitrary `string` arguments; equality is plain string equality, so sub-graphs in different parts of the codebase can use the same label name without coordination.

3. **`Node` is a value, not a base class.** The interface is `{ label, input(), output(), run(ctx) }`. Implementations are plain objects (singleton constants for stateless nodes like `CameraDriverNode` and `MainPassNode`) or classes (when state-per-instance is wanted, e.g. plugins with configuration). No `AbstractNode` to extend; composition over inheritance per ADR-0001.

4. **`ViewNode` is `Node` with a brand.** `interface ViewNode extends Node { readonly __viewNode: true }`. A view node declares it expects `NodeRunContext.view` to be set when it runs — i.e. it runs once per active camera, inside a camera-driven sub-graph. The runner does not enforce the contract beyond supplying `view` when it has one; `MainPassNode` checks `ctx.view` at the top of `run` and throws if absent, so a misconfiguration surfaces immediately.

5. **The slot type system is declared now; only `Entity` is consumed today.** `SlotType.Entity | TextureView | Buffer | Sampler` and `SlotInfo` / `SlotValue` / `SlotValues` ship in `slot.ts`. The roadmap entry for §5.1 ("typed input/output slots") puts the type system in scope; deferring it to the first §5.5 consumer would force a graph rewrite to retrofit it. Day-1 nodes all declare empty slot lists — there is no inter-node data flow yet (the encoder and the view ride on the `NodeRunContext`, not on slot edges). When transient textures land in §5.5, slot edges between nodes become the carrier; the type system is already in place.

6. **`RenderSubGraph` is flat — no nesting.** A sub-graph holds `Node`s and ordering edges between them, with its own topological sort. Sub-graphs cannot contain other sub-graphs; the only nesting in the system is `RenderGraph → CameraDriverNode → sub-graph`. Modelling sub-graphs as themselves nestable opens an obvious foot-gun ("Core2d contains Core3d") that nothing wants.

7. **`RenderGraph` holds top-level nodes + a sub-graph registry.** Inserted as an App resource by `RenderGraphPlugin.build`. Today's only top-level node is `CameraDriverNode`; the registry holds `Core2d` and `Core3d` by default. Top-level edges exist for symmetry — nothing uses them on day 1. `runSubGraph(label, ctx)` is the dispatch point that `CameraDriverNode` calls to invoke each camera's sub-graph.

8. **Kahn's-algorithm topological sort; cached at freeze; freeze on first frame.** `RenderGraph.freeze()` runs Kahn's algorithm at the top level and recurses into every registered sub-graph. Idempotent. Throws on cycle with the unresolved labels named in the error message. `App.renderFrame()` calls `freeze()` at the start of every frame; the first call does the work, subsequent calls are no-ops. Post-freeze mutation — `addNode`, `addEdge`, `addSubGraph` on the graph or any sub-graph — throws. Plugins register nodes and edges during `build` or `finish`; user code that needs to mutate the graph at runtime must request a new lifecycle (none exists today).

9. **`CameraDriverNode` owns the per-frame encoder and the camera iteration.** Reading `SortedCameras` from the App, it creates one `CommandEncoder`, iterates `views`, looks up each camera's sub-graph via `view.subGraph`, builds a per-camera `NodeRunContext` with `view` and `encoder` set, calls `subGraph.run(childCtx)`, and submits the encoder after the loop. A camera whose `subGraph` label has no registered sub-graph is skipped with a one-shot `devWarn` (per label, per frame) and rendering continues. Stateless; safe as a singleton.

10. **`MainPassNode` is the §5.7 shim.** A singleton `ViewNode` that, given an active `view` and `encoder` on its context, builds the `ColorAttachment` from `view.target` / `view.loadOp` / `view.clearColor` (verbatim from the pre-Phase-5 lambda), calls `encoder.beginRenderPass`, builds the `RenderContext` (`{ encoder, pass, surfaceView, camera }`), calls `App.runRenderSet(ctx.renderSetSystems.get(RenderSet.Render), RenderSet.Render, renderContext)`, and ends the pass. Registered under `MainPassLabel` inside both `Core2d` and `Core3d` default sub-graphs. The body is the lambda the ADRs promised would relocate "without restructuring" — every system registered in `RenderSet.Render` continues to run unchanged, once per active camera. The shim is replaced in `Core2d` by the Phase 8 sprite phase nodes; the shim is replaced in `Core3d` by Phase 10's lighting + Phase 12's prepass + main + post pipeline.

11. **`Camera.subGraph: RenderLabel` is an inline field on `Camera`.** Defaults to `Core2dLabel`. `Camera2d()` inherits the default; `Camera3d()` sets `Core3dLabel`. Mirrored through `ExtractedCamera.subGraph` (extracted by `CameraPlugin`'s `RenderSet.Extract` system) and `CameraView.subGraph` (populated by `prepareCameras` in `RenderSet.Prepare`) so `CameraDriverNode` reads it off the per-frame view without re-reaching into the main world. Inline rather than a separate `CameraRenderGraph` newtype component for consistency with the rest of `Camera` (which already inlines `viewport`, `target`, `clearColor`, etc.).

12. **The fallback clear pass stays outside the graph.** When `SortedCameras.views.length === 0` and a surface exists, `App.renderFrame()` emits a single `'fallback-clear'` pass directly — unchanged from the pre-Phase-5 code. Routing this degenerate "no cameras" case through the graph would add machinery for one edge case; keeping it in `renderFrame` is simpler and preserves the observable behaviour `apps/studio` relies on (it currently runs with no cameras).

13. **`App.runRenderSet` becomes `@internal public`.** The pre-Phase-5 method was `private`; `MainPassNode` needs to invoke it. `@internal` documents that downstream code outside the engine package should not call it directly — the public surface is "register a system in `RenderSet.Render`, the graph dispatches it." The method body is unchanged from ADR-0019; this is purely a visibility change.

Composition-only. No abstract `Node` / `RenderGraph` base class. The HAL types (`CommandEncoder`, `RenderPassEncoder`, `ColorAttachment`) are referenced through `renderer-core`'s public exports, not subclassed. `renderer-core` and `renderer-webgpu` are not edited by this ADR.

## Consequences

**Easier:**

- Phase 8's sprite phases land inside `Core2d` by *replacing* `MainPassNode` with three phase nodes (`Opaque2d`, `AlphaMask2d`, `Transparent2d`); `Core3d` and `CameraDriverNode` are not touched.
- Phase 9's 2D lighting accumulate-then-composite is expressed naturally — a `LightAccum2dNode` writing a per-camera light texture, then `Light2dCompositeNode` after `MainPassNode` (or after the Phase 8 phase trio). Slot edges between them carry the light texture once §5.5 lands.
- Phase 12's post-processing nodes plug in by appending to `Core2d` / `Core3d`. The driver and the camera pipeline don't change shape.
- Phase 12.8's prepasses plug in by inserting nodes *before* the main pass node — the topological sort handles ordering once the edges are declared.
- Plugins can ship a custom sub-graph (`createLabel('my_plugin::custom')`, register it on the `RenderGraph`, build a `Camera` with `subGraph: MyCustomLabel`) without touching engine code.
- Multi-camera scenes pick different sub-graphs per camera (`Camera2d({ subGraph: ... })`); the driver dispatches the right one for each.
- Test surface is small: graph builder unit tests (topological sort, cycle detection, edge validation, post-freeze mutation, sub-graph lookup) are pure; the plugin integration test reuses the existing `makeRenderingRenderer` stub.

**Harder / accepted trade-offs:**

- **Graph freeze is a new failure mode.** Plugins that register nodes or edges from a place that runs after the first frame — e.g. a `runIf`-gated system, or a deferred `app.addPlugin` call — will hit a `frozen` error. The lifecycle anchor is plugin `build` and plugin `finish`; nothing past that point is safe. Documented in the plugin TSDoc and surfaced clearly in the error message.
- **`MainPassNode`'s "one node = one pass" shape is preserved for migration but constrains Phase 8.** When sprite phases land, they will each open their own render pass against the same camera target (matching Bevy's `MainPass2dNode` shape), or share an outer pass node. Either is straightforward; the limitation is that today's `Core2d` sub-graph has exactly one node, and replacing it with three coordinated nodes requires Phase 8's own ADR.
- **Per-camera `ViewVisibility` is still aggregate-boolean.** ADR-0021 deferred per-camera filtering to "the Phase 5 render-graph ADR is the natural place to fix this." We chose not to fix it here — no concrete consumer suffers yet (multi-camera scenes that need it can use `RenderLayers` masks today), and shipping a per-camera bitset without a measured consumer is design-for-hypothetical. The slot system carries it cleanly when one appears.
- **`@group(0) = view` is still not auto-bound.** Backlog item `docs/backlog/view-bind-group-zero-convention.md` still pins this to Phase 7 (Materials). The graph is the obvious hook for auto-bind (every `ViewNode` would receive the view bind group pre-bound on its pass), but Phase 5 ships without it — Phase 7 will land the convention as a hard rule, and the graph is ready to enforce it.
- **No slot-edge type checking at runtime today.** Day-1 nodes declare empty slot lists, so the type-check path has no exercise. The `SlotValue` discriminant will be validated at edge-construction time when the first inter-node slot edge lands (§5.5).
- **`runRenderSet` exposed as `@internal`.** The method is now part of the engine's surface, even if downstream code should not call it. Future renames carry a churn cost that the pre-Phase-5 `private` shape avoided.

## Not yet done

Each entry below is deferred until its trigger consumer lands. None is hidden in code — the only way to find these gaps is this ADR.

- **Transient resource allocator (roadmap §5.5).** Slot edges carrying intra-frame texture / buffer resources, with optional aliasing. First consumer is Phase 12's bloom or Phase 9's light texture.
- **Cross-frame history resources (roadmap §5.6).** Persistent textures the graph hands a node from frame N+1 referring to frame N's output. First consumer is TAA in §12.6.
- **Studio render-graph visualiser (roadmap §5.8).** Inspector pane showing the graph topology, slot edges, and per-node timing. Deferred to Phase 15.
- **Per-camera `ViewVisibility`** (ADR-0021 open question). Lands when a consumer suffers from the aggregate-boolean.
- **`@group(0) = view` auto-bind** (`docs/backlog/view-bind-group-zero-convention.md`). Phase 7 pins it.
- **Phase 8 sprite phases displace `MainPassNode` in `Core2d`.** When `Opaque2d` / `AlphaMask2d` / `Transparent2d` land, they replace the single `MainPassLabel` registration with a phase-ordered trio.
- **Phase 10 depth + lighting + Phase 12 prepass + post in `Core3d`.** Same shape: nodes added before / after `MainPassLabel`, eventually displacing it entirely.

## Implementation

- `packages/engine/src/render-graph/render-label.ts` — `RenderLabel` branded type and `createLabel` helper.
- `packages/engine/src/render-graph/slot.ts` — `SlotType`, `SlotInfo`, `SlotValue`, `SlotValues`, `EMPTY_SLOT_VALUES`.
- `packages/engine/src/render-graph/node.ts` — `Node`, `ViewNode`, `NodeRunContext`, `isViewNode`.
- `packages/engine/src/render-graph/render-graph.ts` — `RenderGraph` class (top-level nodes + sub-graph registry, Kahn's sort, freeze).
- `packages/engine/src/render-graph/sub-graph.ts` — `RenderSubGraph` class (flat node collection, own sort, own freeze cascaded from the graph).
- `packages/engine/src/render-graph/camera-driver-node.ts` — `CameraDriverNode`, `CameraDriverLabel`.
- `packages/engine/src/render-graph/main-pass-node.ts` — `MainPassNode`, `MainPassLabel`.
- `packages/engine/src/render-graph/core-2d.ts` — `Core2dLabel`, `buildCore2dSubGraph`.
- `packages/engine/src/render-graph/core-3d.ts` — `Core3dLabel`, `buildCore3dSubGraph`.
- `packages/engine/src/render-graph/render-graph-plugin.ts` — `RenderGraphPlugin` (registers resource + default sub-graphs at build time).
- `packages/engine/src/render-graph/index.ts` — submodule re-exports.
- `packages/engine/src/render-graph/render-graph.test.ts` — sub-graph + graph builder unit tests (topo sort, insertion-order tiebreak, duplicate / unknown / self-loop / cycle errors, freeze cascade, post-freeze throw, `runSubGraph`).
- `packages/engine/src/render-graph/render-graph-plugin.test.ts` — plugin installs resource, registers default sub-graphs, freezes on first frame; custom-sub-graph dispatch; missing-sub-graph one-shot warn.
- `packages/engine/src/index.ts` — `renderFrame` per-camera loop replaced with `graph.freeze()` + `graph.run(ctx)`; `runRenderSet` exposed as `@internal`; render-graph submodule re-exported under `RenderNode` / `RenderNodeRunContext` / `ViewNode` / `RenderGraph` / `RenderSubGraph` / `RenderGraphPlugin` / `CameraDriverNode` / `CameraDriverLabel` / `MainPassNode` / `MainPassLabel` / `Core2dLabel` / `Core3dLabel` / `buildCore2dSubGraph` / `buildCore3dSubGraph` / `RenderLabel` / `createLabel` / `SlotType` / `SlotInfo` / `SlotValue` / `SlotValues` / `EMPTY_SLOT_VALUES` / `isViewNode`.
- `packages/engine/src/core-plugin.ts` — `CorePlugin` registers `RenderGraphPlugin` after `ShaderPlugin` / `CameraPlugin` / `VisibilityPlugin`.
- `packages/engine/src/camera/camera.ts` — `Camera.subGraph` field (defaults to `Core2dLabel`); `CameraView.subGraph`.
- `packages/engine/src/camera/camera-bundles.ts` — `Camera3d()` factory defaults `subGraph` to `Core3dLabel`.
- `packages/engine/src/camera/extracted.ts` — `ExtractedCamera.subGraph` field.
- `packages/engine/src/camera/camera-plugin.ts` — extract / prepare systems thread `subGraph` through.
