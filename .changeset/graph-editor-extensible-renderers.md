---
'@retro-engine/graph-editor': minor
---

feat(graph-editor): pluggable edge paths, edge types, node renderers, backgrounds + port sides

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
