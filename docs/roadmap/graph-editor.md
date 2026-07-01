# Graph Editor Toolkit — `@retro-engine/graph-editor`

- **Created:** 2026-06-30
- **Status:** Toolkit phases 1–9 complete — model, registries, rendering, interaction,
  connections, reroutes, fields, chrome overlays, MCP + undo, and two graph kinds
  shipped and verified live in the studio. Architecture: ADR-0137 / ADR-0138 / ADR-0139.
  Remaining work is the out-of-scope consumers below.

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

1. **Skeleton + ADRs** — package scaffold, ADR-0137/0138, roadmap, changeset. ✅
2. **Model + serialization** — `GraphDocument` (id-keyed records), `ops`, versioned
   JSON serialize/deserialize, round-trip test + bench. ✅
3. **Registries + environment + one kind** — global data-type/category registries,
   per-kind node-type registry + connection rules on `GraphEnvironment`. ✅
4. **View + transforms + static render** — affine zoom/pan, grid + scanlines, node
   render, layout cache, `GraphEditor.draw`; auto-fit; text-LOD. ✅
5. **Hit-test + selection + node drag** — `pick()`, interaction state machine,
   box-select, multi-drag, delete, nudge. Pick bench. ✅
6. **Pins + wires + connect** — typed pins (dot/exec-triangle, hollow/filled/halo),
   bezier wires + tangent formula, drag-create with validation, wire hit-test. ✅
7. **Reroutes + fields + node states + header variants** — reroute drag/create/
   delete, field widgets (swatch/combo/number/toggle/checkbox) with click-edit,
   all node states, all three header variants. ✅
8. **MCP + GraphHost** — `GraphHost` App resource + `graph.*` commands routed
   through `History` as undoable snapshot-commands (ADR-0139) + audit. ✅
9. **Chrome + second kind** — minimap, status chip, toolbar; a flow/state kind
   (state nodes, transitions with arrowheads + midpoint badges, subgraph group,
   exec pins, subgraph typed rows). Two kinds coexist. ✅

### Known follow-ups (small, non-blocking)

- Direct-manipulation edits (node drag, field toggle, reroute drag) mutate the
  document directly; routing them through the same `History` snapshot-command
  (ADR-0139) so they undo like MCP edits is a tracked follow-up.
- Context/VFX **stack** node style (`NodeStyle` has the slot; renders as a normal
  node today).
- Group move/resize interaction (groups render but aren't draggable yet).

## Out of scope (future backlog when promoted)

These are the *consumers* the toolkit exists to enable. The toolkit must make each
straightforward, but building them is separate work, promoted to `docs/backlog/`
when started:

- Animation state / blend-tree editor rebuilt on the toolkit.
- Visual shader / material language + its compiler.
- Exec-flow blueprint runtime.
- Behavior trees / other user graph kinds.
