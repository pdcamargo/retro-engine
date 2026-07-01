# Graph Editor Toolkit — `@retro-engine/graph-editor`

- **Created:** 2026-06-30
- **Status:** In progress — package scaffolded; architecture sealed in ADR-0137 / ADR-0138.

## Goal

One reusable immediate-mode node-graph editing toolkit that renders and edits any
node graph, reused across future consumers: the animation state / blend tree,
exec-flow blueprints, a visual shader / material language, VFX context stacks, and
subgraphs. Exposed as a public SDK so users author their own node types **and their
own graph kinds**, and drivable over MCP. Scope of this initiative is the **toolkit
itself** — model, registries, rendering, interaction, serialization, SDK surface,
MCP commands, and a studio demo panel that exercises the full acceptance checklist.

Authoritative decisions: [ADR-0137](../adr/ADR-0137-graph-editor-toolkit.md) (toolkit
architecture) and [ADR-0138](../adr/ADR-0138-graph-editor-sdk-draw-and-edit-scope.md)
(draw primitives + edit scope). Visual/behavioral spec is the design handoff (typed
pins, source-colored bezier wires with horizontal tangents, reroute weight-points,
three header variants, node states, state-machine transitions, context stacks,
subgraph groups, toolbar, minimap).

## Phases

Each phase ends with something verifiable in the studio **Graph Editor Demo** panel.

1. **Skeleton + ADRs** — package scaffold, ADR-0137/0138, this roadmap, changeset. ✅
2. **Model + serialization** — `GraphDocument` (id-keyed record collections),
   `ops`, versioned JSON serialize/deserialize, fixtures. Round-trip test + bench.
3. **Registries + environment + one kind** — global data-type/category registries,
   per-kind node-type registry + connection rules on `GraphEnvironment`; a dataflow
   kind. Connection-validation tests.
4. **View + transforms + static render** — affine zoom/pan, grid + scanlines, node
   render (stripe header), layout cache, `GraphEditor.draw` orchestrator. Pannable /
   zoomable static graph in the demo. Render bench.
5. **Hit-test + selection + node drag** — `layout-cache.pick()`, interaction state
   machine, box-select, node move through `History`. Pick bench.
6. **Pins + wires + connect** — pin geometry/states, bezier wires + tangent formula,
   drag-create connections with type validation, wire polyline hit-test. Wire bench.
7. **Reroutes + fields + node states + header variants** — reroute split/rejoin +
   drag, embedded field widgets editing through `History`, all node states, all
   three header variants.
8. **MCP + GraphHost** — `GraphHost` resource + `graph.*` commands routed through
   `History` (asset scope) + audit.
9. **Chrome + second kind** — toolbar, minimap, status chip; a flow/state kind
   (state nodes, transitions with arrowheads + midpoint badges, VFX context stack,
   subgraph group). Two kinds coexist; full acceptance checklist ticked.

## Out of scope (future backlog when promoted)

These are the *consumers* the toolkit exists to enable. The toolkit must make each
straightforward, but building them is separate work, promoted to `docs/backlog/`
when started:

- Animation state / blend-tree editor rebuilt on the toolkit.
- Visual shader / material language + its compiler.
- Exec-flow blueprint runtime.
- Behavior trees / other user graph kinds.
