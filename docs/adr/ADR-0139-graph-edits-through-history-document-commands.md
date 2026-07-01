# ADR-0139: Graph edits route through History as document snapshot-commands

- **Status:** Accepted
- **Date:** 2026-06-30

## Context

[ADR-0138](ADR-0138-graph-editor-sdk-draw-and-edit-scope.md) decided that graph
documents would be edited through the existing **asset** `EditScope` — a
`SetFieldCommand` on `(assetKind, guid)` resolved via the studio's
`AssetEditAccess.getMut`, with structural edits expressed as a wholesale replace
of the affected top-level collection. That decision's premise was "graph
documents are assets (they should be, given serialization)": it assumed a graph
document is loaded into an `AssetServer` store keyed by its GUID, so `getMut`
can return the live value.

In the editor today a graph document is an **in-memory** object owned by a
`GraphHost` (shared by the graph panel and the MCP command layer). It is not yet
registered as an `AssetServer` asset kind — serialization exists as standalone
functions ([ADR-0137](ADR-0137-graph-editor-toolkit.md)), but nothing loads a
`.rgraph` file into a store. So the asset-scope `getMut` path has nothing to
resolve, and the MCP layer needs undo/redo + audit now.

## Decision

Route graph-document mutations through the editor `History` using a
`CustomCommand` whose `apply`/`revert` **snapshot and restore the affected
collections of the in-memory document** (a structural clone of `nodes` / `edges`
/ `reroutes` / `groups` / `nodeOrder` / `counters`). The command closes over the
`GraphHost`'s document and ignores the `world` argument.

- A single helper builds the command: capture a `before` snapshot, run the pure
  document op ([ADR-0137](ADR-0137-graph-editor-toolkit.md) `ops.ts`), capture an
  `after` snapshot; `apply` restores `after`, `revert` restores `before` (each
  from a fresh clone so undo/redo cycles never alias).
- This preserves ADR-0138's collection-replace semantics (stable ids across
  undo/redo, whole-state correctness) without requiring the document to be an
  `AssetServer` asset. `History.apply` records it and the MCP bridge audits it,
  exactly like every other editor edit.
- **ADR-0138 is not superseded.** Its `Draw` primitive additions stand, and its
  asset-scope path remains the mechanism for **persisted** graph assets: when a
  consumer registers a `.rgraph` asset kind and loads documents through the
  `AssetServer`, edits on those may use the asset `EditScope` directly. This ADR
  covers the in-memory editor document that exists before/instead of that.

## Consequences

- MCP `graph.*` mutations and (later) direct-manipulation edits get undo/redo +
  audit through the one editor `History`, with no new `EditCommand` kind,
  `EditScope`, or asset-kind registration.
- Each structural edit clones the document's collections twice (before/after).
  Edits are user/agent-paced (one at a time), so the O(document-size) clone is
  acceptable; a persisted-asset consumer with bulk edits can adopt the
  asset-scope path (ADR-0138) or a finer command then.
- Direct-manipulation interaction edits (node drag, field toggle, reroute drag)
  still mutate the document directly today; wiring them through the same
  snapshot-command is a tracked follow-up, not required by this decision.

## Implementation

- `packages/editor-mcp/src/commands/graph.ts` — the snapshot-command helper and
  the `graph.*` commands (`describe`/`get`/`addNode`/`moveNode`/`connect`/
  `disconnect`/`addReroute`/`removeReroute`/`setField`/`deleteNode`/`setActive`).
- `packages/graph-editor/src/host.ts` — `GraphHost` (shared document registry).
- `apps/studio/src/main.ts` — inserts the `GraphHost` App resource; the panel and
  the MCP `CommandContext` (`ctx.app.getResource(GraphHost)`) share it.
