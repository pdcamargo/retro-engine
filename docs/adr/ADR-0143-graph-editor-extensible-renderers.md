# ADR-0143: Extensible graph-editor renderers (paths, edge types, node renderers, backgrounds, port sides)

- **Status:** Accepted
- **Date:** 2026-07-02
- **Extends:** [ADR-0137](ADR-0137-graph-editor-toolkit.md) (does not supersede — the generic `GraphDocument` model, the adapter boundary, the `GraphEnvironment`-owns-registries decision, the immediate-mode discipline, and the world→screen affine all stand.)

## Context

ADR-0137 built `@retro-engine/graph-editor` as a reusable toolkit, but its render
layer grew as a fixed set of hardcoded cases rather than an open extension surface:

- **Nodes** branch on `type.style` (`node` / `state` / `stack`) inside `drawNode`
  and again inside `layoutNode`. A fourth look means editing the toolkit.
- **Edges** branch on `edge.style === 'transition'` inside `drawEdge` *and* inside
  `pickEdge`. There are exactly two wire shapes.
- **Wires** are always a cubic bezier with horizontal tangents (`wire.ts`). There is
  no straight or orthogonal routing, and no way for a consumer to supply a curve.
- **Connectors** dock only on the left (inputs) and right (outputs) edges. Top /
  bottom docking, and choosing a side by node geometry, are impossible.
- **The canvas background** is a hardcoded dotted grid + scanlines.

This produced concrete defects the Animation Controller surfaced:

1. The transition branch of both `drawEdge` and `pickEdge` **ignores `edge.via`
   reroutes** — double-clicking a transition to drop an anchor point did nothing,
   because only pin-style wires threaded their waypoints.
2. Transition arrowheads were oriented along the straight chord `a→b`, but the wire
   was drawn as a horizontal-tangent bezier — so the head pointed the wrong way,
   worst when travelling rightward.
3. Reciprocal transitions (`A→B` and `B→A`) were drawn as two separate bowed lines
   instead of the conventional single line with an arrowhead on each end.

The toolkit's own charter (ADR-0137) is to be reusable across dataflow, exec-flow,
state machines, VFX stacks, subgraphs, **and consumer-authored kinds**. A fixed set
of cases contradicts that: the moment a consumer wants a different wire, node, or
background they must patch the toolkit. The reference point is
[React Flow](https://reactflow.dev): `nodeTypes`, `edgeTypes`, pluggable edge path
functions (`getBezierPath` / `getStraightPath` / `getSmoothStepPath`), `Handle`
`Position`, a `connectionLineComponent`, and `<Background variant=… />`.

## Decision

Replace the hardcoded case-analysis in the render layer with **registries of
strategies**, keeping the headless model and adapter boundary from ADR-0137
unchanged. A consumer extends the look by *registering*, never by editing the
toolkit.

### 1. Port sides + docking (`Side` / `PortSide`)

- `Side = 'left' | 'right' | 'top' | 'bottom'`; `PortSide = Side | 'auto'`.
- `PinDescriptor` gains an optional `side?: Side` (default: inputs `left`, outputs
  `right` — the existing behavior). The layout places a pin's anchor on its declared
  side, spreading multiple same-side pins along that edge.
- `'auto'` is meaningful only for edge endpoints that attach to a **node edge**
  rather than a fixed pin (transitions). `autoSides(rectA, rectB)` picks, for each
  node, the side that faces the other node, so wires leave the nearest edge and
  clutter drops.

### 2. Edge path strategies (`edge-path.ts`)

An `EdgePathFn` maps resolved screen-space endpoints (`{ pos, side }` each) plus
ordered waypoints (reroute knots) to an `EdgeShape` — a list of cubic segments
`[p0, c1, c2, p3]`. A straight segment is a cubic with colinear control points, so a
single draw/hit-test/tangent path serves every strategy. Built-ins seeded on the
environment: `bezier` (tangents follow each endpoint's side normal — horizontal for
left/right, vertical for top/bottom), `straight`, `orthogonal` (axis-aligned
step). Helpers: `drawEdgeShape`, `edgeShapeDistance` (hit-test), `edgeShapeMidpoint`
(badge anchor), and start/end **tangents** so decorations orient to the actual
curve, not the chord.

### 3. Edge-type registry (`edge-type.ts`, per `GraphKind`)

An `EdgeTypeDescriptor` declares how a class of edge attaches and draws:
`endpoints` (`'pins'` | `'nodes'`), `dock` (`PortSide`, for `'nodes'`), `path`
(a built-in id or an `EdgePathFn`), `arrow` (`{ start?, end? }`), `mergeReciprocal`
(collapse `A↔B` to one double-arrow line), `badge`, and an optional `render`
override (a full `EdgeRenderer`). `GraphEdge.style` is widened from the `'transition'`
literal to a free **edge-type id**; `undefined` selects the kind's default data-wire
type. Resolution is kind-first, then environment built-ins (`default`, `transition`),
so existing `style: 'transition'` documents keep working without per-kind
registration.

### 4. Node-renderer registry (`node-render.ts`, on `GraphEnvironment`)

`NodeRenderer = (DrawNodeParams) => void`, keyed by node `style` string. The three
built-ins (`node` / `state` / `stack`) are registered at environment creation;
`drawNode` dispatches through the registry instead of an `if/else`. A node type may
also carry an optional `measure` hook for custom sizing; absent, the default
row-based layout applies.

### 5. Background registry (`background.ts`, on `GraphEnvironment`)

`BackgroundRenderer = (Draw, origin, size, view, theme) => void`, keyed by id.
Built-ins: `grid` (the existing dotted grid), `dots`, `lines`, `none`. `GraphView`
carries a `background` id (default `grid`); scanlines remain a separate view toggle
layered on top.

### Reciprocal merge + selection

`mergeReciprocal` is **purely visual**: both directed edges remain in the document.
The pair is drawn once (from the lexicographically-smaller edge id) with an
arrowhead on each end; the reverse is skipped in the draw pass. Hit-testing selects
the primary edge. Editing/deleting a specific direction is still done from the
inspector — merging never mutates the model.

## Consequences

- Adding a wire shape, a node look, a background, or a docking rule is a
  registration against the environment/kind — the toolkit stays closed to
  modification, open to extension, honoring ADR-0137's reusability charter.
- The three Animation Controller defects are fixed *by construction*: one geometry
  resolver feeds both draw and pick (reroutes thread through every edge type),
  arrowheads read the path tangent, and reciprocal pairs merge.
- `edge.style` becoming a free id is backward compatible on disk (`serialize.ts`
  stores it verbatim; `'transition'` still resolves). No format bump.
- One geometry resolver per edge per frame is marginally more work than the old
  inline branch; it is O(segments) and bench-guarded (`edge-path.bench.ts`).
- Consumer-authored kinds can now ship wholly custom visuals, which widens the
  surface the toolkit must keep stable — the strategy signatures (`EdgePathFn`,
  `NodeRenderer`, `BackgroundRenderer`, `EdgeRenderer`) are now public API.

## Implementation

- `packages/graph-editor/src/side.ts` — `Side`, `PortSide`, `sideNormal`,
  `oppositeSide`, `autoSides`.
- `packages/graph-editor/src/edge-path.ts` — `EdgeShape`, `EndpointGeom`,
  `EdgePathFn`, built-in `bezierPath` / `straightPath` / `orthogonalPath`,
  `drawEdgeShape`, `edgeShapeDistance`, `edgeShapeMidpoint`, `edgeShapeTangents`.
- `packages/graph-editor/src/edge-type.ts` — `EdgeTypeDescriptor`, `EdgeRenderer`,
  `EdgeTypeRegistry`; `GraphKind.edgeTypes`.
- `packages/graph-editor/src/edge-render.ts` — `resolveEdgeGeom`, the built-in
  `drawEdge` renderer (endpoints, docking, arrowheads, badge, reciprocal merge).
- `packages/graph-editor/src/background.ts` — `BackgroundRenderer`, built-in
  `grid` / `dots` / `lines` / `none`.
- `packages/graph-editor/src/node-render.ts` — `NodeRenderer`, built-in
  `node` / `state` / `stack` renderers, registry dispatch in `drawNode`.
- `packages/graph-editor/src/environment.ts` — `registerEdgePath`,
  `registerNodeRenderer`, `registerBackground`, and `edgeType` / `edgePath` /
  `nodeRenderer` / `background` resolvers (kind-first, built-in fallback).
- `packages/graph-editor/src/kind.ts` — `edgeTypes` registry on `GraphKind`.
- `packages/graph-editor/src/node-type.ts` — `PinDescriptor.side`,
  `NodeTypeDescriptor.measure`.
- `packages/graph-editor/src/document.ts` — `GraphEdge.style` widened to an
  edge-type id string.
- `packages/graph-editor/src/{graph-editor,interaction,layout-cache,canvas}.ts` —
  draw/pick route through the resolvers; layout honors `PinDescriptor.side`.
- `apps/studio/src/animator/*` — Animation Controller transitions (`edge.style =
  'transition'`, set in `ac-codec.ts`) resolve to the built-in `transition` edge
  type (`endpoints: 'nodes'`, `dock: 'auto'`, `path: 'straight'`, `arrow.end`,
  `mergeReciprocal`, `badge`) with no per-kind registration; double-click adds
  anchor points that the straight path now threads. A kind that wants a different
  transition look re-registers the id on its `GraphKind.edgeTypes`.
