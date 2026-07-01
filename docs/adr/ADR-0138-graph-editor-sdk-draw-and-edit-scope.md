# ADR-0138: Graph-editor draw primitives and edit scope reuse the existing substrate

- **Status:** Accepted
- **Date:** 2026-06-30

## Context

ADR-0137 builds `@retro-engine/graph-editor` on `editor-sdk`. Two substrate
questions had to be resolved before the render and MCP layers could be written,
and both looked like they might force changes to the shared `editor-sdk`:

1. **Draw-list text and beziers.** `Draw.text` (`editor-sdk/src/draw.ts`) submits a
   real ImGui item per call (a cursor save/restore + `Text` + a `Dummy`), which at
   ≥500 nodes × several labels each blows the frame budget and pollutes the ID
   space. The node graph needs a pure draw-list text path (no item) and cubic
   beziers for wires. Inspection of the jsimgui binding (`imgui.d.ts`) shows the
   raw `ImDrawList` already exposes `AddTextImFontPtr` (sized text, no item),
   `AddBezierCubic`, and `ChannelsSplit`/`ChannelsMerge`; `PushFontFloat` (dynamic
   fonts) is already wrapped by `ui.withFont`. The primitives exist — the question
   was only whether `graph-editor` should reach the raw binding itself.

2. **Undo/redo + MCP scope for a graph document.** `History` records
   `EditCommand`s whose `EditScope` (`editor-sdk/src/edit/scope.ts`) is either an
   entity component or an asset (`assetKind` + `guid`). A `GraphDocument` is neither
   an entity nor obviously an asset. But `SetFieldCommand` with an `asset` scope
   already writes an arbitrary nested `FieldPath` onto a live asset value through
   `AssetEditAccess.getMut(assetKind, guid)` + `writePathLeaf` — and `writePathLeaf`
   addresses object/array members by key, including setting a not-yet-present key.

## Decision

Reuse the existing substrate; make only two small additive changes to `editor-sdk`.

- **`editor-sdk` gains two thin `Draw` wrappers** so `graph-editor` depends only on
  `editor-sdk` and never imports jsimgui directly:
  - `Draw.textAt(pos, col, text, opts?)` — a pure `ImDrawList.AddTextImFontPtr`
    call (no ImGui item submitted), resolving the font by name from the SDK's font
    registry and taking an explicit pixel size. Node labels use this.
  - `Draw.bezierCubic(p1, p2, p3, p4, col, thickness, segments?)` — a wrapper over
    `AddBezierCubic`. Wires use this.
  These are additive (an `editor-sdk` minor). Channel-splitting is left unwrapped;
  the toolkit uses two draw planes (`Draw.window()` + `Draw.foreground()`, already
  present) and only wraps channels later if true interleaving is needed.
- **No edit-scope change.** Graph documents are edited entirely through the
  existing **asset `EditScope`**:
  - A `GraphDocument` is exposed as a stored asset (`.rgraph` kind, GUID). The
    studio wires an `AssetEditAccess` whose `getMut('.rgraph', guid)` returns the
    live document.
  - Its `nodes` / `edges` / `reroutes` / `groups` collections are **id-keyed
    plain-object records** (not `Map`s or arrays), so a `FieldPath` can address
    `['nodes', id, 'pos', 'x']`, etc.
  - **Field / position edits** are fine-grained `SetFieldCommand`s on nested paths,
    with `History.preview`/`sync` coalescing for drags — identical to how the
    inspector edits component fields.
  - **Structural edits** (add / remove node, edge, reroute) are a `SetFieldCommand`
    that replaces the affected top-level collection field wholesale
    (`path: ['nodes']`, `before`/`after` = the whole record). This is correct and
    undoable with zero new command kinds; `writePathLeaf`'s inability to *delete* a
    key cleanly is why structural edits replace the collection rather than poke a
    single key.

## Consequences

- `graph-editor` reaches the ImGui draw list only through `editor-sdk`, preserving
  the module boundary (`graph-editor → editor-sdk`, never jsimgui directly).
- Editor undo/redo, coalescing, the audit ring, and the MCP mutation path all work
  for graph documents with no new `EditCommand` kind, `EditScope`, or `History`
  code — the graph inherits the same edit stack the inspector uses.
- Wholesale collection replacement on a structural edit deep-clones that collection
  for the before/after snapshots — O(collection size) memory per structural op.
  Structural edits are user-paced (one node/edge at a time), so this is acceptable;
  if a future consumer performs bulk structural edits, a patch-style command kind
  can be added then (its own ADR).
- Requiring id-keyed plain-object records (over `Map`s) is a real constraint on the
  document model, adopted deliberately so the reflect `FieldPath` machinery — the
  same one the inspector and animation tracks use — addresses graph internals.

## Implementation

- `packages/editor-sdk/src/draw.ts` — `Draw.textAt`, `Draw.bezierCubic`.
- `packages/graph-editor/src/document.ts` — id-keyed record collections on
  `GraphDocument`.
- `packages/graph-editor/src/ops.ts` — mutations expressed as fine-grained vs
  collection-replace `SetFieldCommand`s.
- `packages/editor-mcp/src/commands/graph.ts` — routes `graph.*` mutations through
  `History` on the asset scope.
