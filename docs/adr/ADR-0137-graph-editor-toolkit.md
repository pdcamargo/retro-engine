# ADR-0137: Reusable node-graph editor toolkit

- **Status:** Accepted
- **Date:** 2026-06-30

## Context

The engine needs a node-graph editor in several places: an animation state / blend
tree, exec-flow blueprints, a future visual shader / material language, VFX context
stacks, and subgraphs. These share a visual language and interaction model but
differ in their node vocabulary and connection rules. Building a bespoke editor per
consumer would duplicate the hard parts (pan/zoom, wire routing, hit-testing,
selection, undo) and drift visually.

Prior state: the studio renders in immediate-mode Dear ImGui (jsimgui). Three
graph-shaped systems already exist and are independent — the render graph
(`packages/engine/src/render-graph`), the animation controller state machine
(`packages/engine/src/animation`, serialized as `.ranimctrl`), and blend trees —
none of them an authored editor. There is no shared graph-editing layer. The
`math` package has `Vec2`/`Mat3` but no curve utilities. `editor-sdk` provides the
ImGui wrapper (`Draw` over `ImDrawList`, `ui` input/hit-test helpers), the panel
registry (`PanelDef` + `editor.addPanel()`), the design tokens/palette, and the
`History` undo stack (entity/component/asset scoped).

A design handoff fixed the target visual language and behavior (typed pins, a fixed
hue per data type, hollow→filled pins, source-colored bezier wires with horizontal
tangents, reroute weight-points, three header variants, node states, state-machine
transitions with arrowheads + midpoint badges, context stacks, subgraph groups,
toolbar, minimap). The runtime target is ImGui, so the toolkit reproduces the
behavior and visual language rather than the reference's DOM/SVG markup.

## Decision

Build a reusable toolkit as a new package **`@retro-engine/graph-editor`**,
depending only on `@retro-engine/editor-sdk` + `@retro-engine/math`. The studio and
`@retro-engine/editor-mcp` consume it; the graph is drawn with custom draw-list
calls (jsimgui's bundled `imnodes` cannot express reroute weight-points,
transition badges, context stacks, subgraph groups, three header variants,
embedded field rows, or non-dataflow paradigms).

- **Editor-only generic model with an adapter boundary.** The toolkit owns a
  generic `GraphDocument` (nodes, edges, reroute knots, groups). Consumers map their
  runtime graph to/from it and never leak runtime types into the toolkit.
- **A `GraphEnvironment` instance owns the registries** — a *global*
  `DataTypeRegistry` + `CategoryRegistry` (one shared color language across all
  kinds) and a *per-kind* `NodeTypeRegistry` + connection-validation rules. No
  module-level singletons. A `GraphKind` references data types by id; it does not
  redeclare their colors. This is what makes multiple graphs — built-in and
  user-authored — coherent: shared type palette, distinct node vocabularies.
- **Layered, one concern per file.** Headless model (`document`, `ops`,
  `serialize`) → registries/environment → `theme` → transient per-view state
  (`view`) → a per-frame `layout-cache` exposing `pick(worldPos)` → immediate-mode
  render/interaction. The `layout-cache` is a first-class layer (derived node rects,
  pin anchors, wire polylines) so hit-testing and rendering read the same geometry
  and a spatial index can drop in later behind `pick()`.
- **Explicit interaction state machine** living in `GraphView`:
  `idle | panning | marquee | dragNode | dragReroute | connecting`. One transition
  per frame, reading the derived hover; only committed results mutate the document
  (through `History`).
- **Immediate-mode discipline.** Manual spatial hit-testing against the culled
  layout cache — not one `InvisibleButton` per pin (which would submit thousands of
  items at 500 nodes). One background `InvisibleButton` for empty-canvas
  pan/marquee; real ImGui items only for embedded field widgets. Two draw planes
  (window content + foreground overlays) with per-frame z-sorted nodes as the
  default; `ImDrawList` channel-splitting is available on the binding if true
  interleaving is ever needed.
- **Zoom is a uniform world→screen affine** (`screen = world · zoom + pan`) applied
  at emit time; every linear dimension scales by `zoom`, wire tangents
  (`k = clamp(|dx|·0.5, 26, 150)`) are computed in world space so curve shape is
  zoom-invariant, zoom is cursor-anchored and clamped 0.35–2.0. Text does not scale
  with coordinates: node labels draw via sized draw-list text
  (`ImDrawList.AddTextImFontPtr`, no ImGui item), embedded widgets via
  `ui.withFont` (`PushFontFloat`, ImGui 1.92 dynamic fonts → crisp at any size);
  sizes snap to ~1px buckets and labels are culled below ~0.5 zoom.
- **Graph documents are assets.** A `GraphDocument` carries a GUID and a `.rgraph`
  asset kind; `serialize`/`deserialize` are versioned JSON with GUID references
  (mirroring the engine's `AssetSerializer` pattern). This homes serialization and
  routes editor undo/redo + MCP mutations through an asset-scoped edit rather than a
  bespoke undo stack (see ADR-0138 for the edit-scope mechanics).

## Consequences

- One toolkit, many graphs: the animation editor, a shader graph, and user-authored
  kinds all share pan/zoom, wire routing, selection, undo, minimap, and the visual
  language. Adding a kind is registering node/data types + connection rules.
- The generic model plus adapter boundary means consumers keep their own runtime
  representations; the cost is an explicit map-in/map-out per consumer, paid when
  each consumer is built (out of scope here).
- Custom draw-list rendering (over `imnodes`) is more code but is the only path that
  reproduces the reference and supports non-dataflow paradigms.
- Manual hit-testing + two draw planes keep 60 fps reachable at ≥500 nodes but mean
  the toolkit owns precedence/consumption logic ImGui would otherwise handle.
- Treating documents as assets gives serialization and undo for free but ties a
  document's identity to a GUID and the asset edit scope (ADR-0138).

## Implementation

- `packages/graph-editor/src/index.ts` — public re-exports.
- `packages/graph-editor/src/{document,ops,serialize}.ts` — `GraphDocument`,
  document mutations, versioned JSON (`GRAPH_FORMAT_VERSION`).
- `packages/graph-editor/src/{data-type,category,node-type,field,kind,environment}.ts`
  — `DataTypeRegistry`, `CategoryRegistry`, `NodeTypeRegistry`, field descriptors,
  `GraphKind`, `GraphEnvironment` (`registerType`/`registerCategory`/`registerKind`).
- `packages/graph-editor/src/{theme,view,layout-cache,interaction}.ts` —
  `GraphTheme`/`setTheme`, `GraphView`/`createGraphView`, layout cache + `pick`,
  interaction state machine.
- `packages/graph-editor/src/{canvas,node-render,pin-render,wire,state-node,stack-node,group,minimap,toolbar,status,graph-editor}.ts`
  — immediate-mode render; `GraphEditor.draw`.
- `packages/editor-mcp/src/commands/graph.ts` — `graph.*` commands + `GraphHost`.
- `apps/studio/src/panels-graph-demo.ts` — the demo/acceptance panel.
