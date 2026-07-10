# @retro-engine/graph-editor

## 0.1.0

### Minor Changes

- a39203c: feat(editor-mcp): graph.\* commands + GraphHost

  `@retro-engine/graph-editor` gains a `GraphHost` — a shared registry of open
  graph documents (keyed by GUID) plus the environment they're authored against —
  registered as an App resource so the editor panel and the MCP layer operate on
  the same document.

  `@retro-engine/editor-mcp` adds the `graph.*` command set: `describe` (kinds /
  node types / data types / categories), `get`, and the mutating `addNode` /
  `moveNode` / `connect` / `disconnect` / `addReroute` / `removeReroute` /
  `setField` / `deleteNode` / `setActive`. `connect` validates against the kind's
  rules. Mutations route through the editor `History` as undoable snapshot-commands
  (ADR-0139) and are recorded in the audit ring.

- 83de76c: feat(graph-editor): pluggable edge paths, edge types, node renderers, backgrounds + port sides

  Per ADR-0143. The render layer moves from hardcoded case-analysis (`node.style`,
  `edge.style === 'transition'`, always-bezier wires, left/right-only pins) to open
  strategy registries, and fixes the transition-edge defects that surfaced in the
  Animation Controller.

  **New public surface:**

  - `Side` / `PortSide` + `sideNormal` / `oppositeSide` / `autoSides` / `sideMidpoint` —
    connectors dock `left` / `right` / `top` / `bottom`, or `auto` (the side facing the
    connected node). `PinDescriptor.side` declares a pin's edge.
  - `EdgePathFn` + built-in `bezierPath` / `straightPath` / `orthogonalPath`, plus
    `EdgeShape` helpers (`drawEdgeShape`, `edgeShapeDistance`, `edgeShapeMidpoint`,
    `edgeShapeTangents`). Register custom curves via `GraphEnvironment.registerEdgePath`.
  - `EdgeTypeDescriptor` + `EdgeTypeRegistry` (on `GraphKind.edgeTypes`) + the built-in
    `default` / `transition` types. An edge type declares `endpoints` (`'pins'` |
    `'nodes'`), `dock`, `path`, `arrow`, `mergeReciprocal`, `badge`, and an optional
    `render` override. `resolveEdgeGeom` / `drawDefaultEdge` / `reciprocalPartner` /
    `isMergedAway` are exported for custom renderers.
  - `NodeRenderer` + `BUILTIN_NODE_RENDERERS` + `GraphEnvironment.registerNodeRenderer`;
    `NodeTypeDescriptor.measure` for custom sizing.
  - `BackgroundRenderer` + `grid` / `dots` / `lines` / `none` +
    `GraphEnvironment.registerBackground`; `GraphView.background` selects one.

  **Behaviour changes:**

  - `GraphEdge.style` is widened from the `'transition'` literal to a free edge-type id
    (`undefined` = `'default'`). On-disk compatible — `serialize` stores it verbatim and
    `'transition'` still resolves.
  - Transitions now draw as straight lines that auto-dock to the facing node edges,
    thread their reroute waypoints (double-click-to-anchor works), orient arrowheads to
    the actual path tangent, and collapse reciprocal `A↔B` pairs into a single line with
    an arrowhead on each end. `drawEdge` / `pickEdge` share one geometry resolver.

- a0f614e: feat(graph-editor): reusable node-graph editor toolkit — package scaffold

  New package `@retro-engine/graph-editor`: a reusable immediate-mode node-graph
  editing toolkit for the studio, built on `@retro-engine/editor-sdk` + `@retro-engine/math`.
  One editor component renders and edits any node graph (dataflow, exec-flow, state
  machines, context stacks, subgraphs) with typed pins, source-colored bezier wires,
  reroute weight-points, and embedded fields; consumers register their own graph kinds
  and drive it over MCP. Per ADR-0137 (architecture) and ADR-0138 (draw primitives +
  edit-scope reuse).

  This changeset covers the package scaffold + sealed architecture; model, registries,
  rendering, interaction, serialization, MCP commands, and the studio demo panel land
  in the phased roadmap (`docs/roadmap/graph-editor.md`).

### Patch Changes

- Updated dependencies [6ce8fae]
- Updated dependencies [7d40c1a]
- Updated dependencies [952766f]
- Updated dependencies [d4b6766]
- Updated dependencies [01e2615]
- Updated dependencies [7e26e59]
- Updated dependencies [5d7a21a]
- Updated dependencies [03688a4]
- Updated dependencies [9e2aaf5]
- Updated dependencies [dc943f5]
- Updated dependencies [77f0ed5]
- Updated dependencies [2abd75c]
- Updated dependencies [0408a70]
- Updated dependencies [3df2cb6]
- Updated dependencies [0625db9]
- Updated dependencies [4c93e0b]
- Updated dependencies [fad8a5e]
- Updated dependencies [391b3c2]
- Updated dependencies [7a1d32c]
- Updated dependencies [0eca147]
- Updated dependencies [45af863]
- Updated dependencies [ecfc0e3]
- Updated dependencies [056bfc9]
- Updated dependencies [e97fdd2]
- Updated dependencies [9d37161]
- Updated dependencies [62effe1]
- Updated dependencies [92d6c91]
- Updated dependencies [f8079c6]
- Updated dependencies [1b98dc4]
- Updated dependencies [ae68f06]
- Updated dependencies [73fdef4]
- Updated dependencies [acae153]
- Updated dependencies [05b372f]
- Updated dependencies [5cf81f9]
  - @retro-engine/editor-sdk@0.1.0
  - @retro-engine/math@0.1.0
