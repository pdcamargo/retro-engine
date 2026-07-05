# Persistent sibling reordering in the hierarchy tree

- **Created:** 2026-07-04

## Context

The hierarchy tree now supports drag-and-drop **reparenting** (drop a node onto
another to make it a child; drop into empty space to move it to the scene root),
which routes through the existing `hierarchy.reparent` command. What it does *not*
support is manually **ordering** siblings — dropping a node *between* two siblings
to fix its position in the list.

Siblings are ordered by entity id everywhere: `buildOutline`
(`packages/editor-sdk/src/world-outline.ts`) sorts roots and each parent's children
by id, and the `Children` list (which does carry an order) is never serialized —
it is rebuilt from each child's `Parent` edge on scene load, in id order. So there
is no authored, round-tripping notion of "the third child".

## Why deferred

True reorder is an engine-level change, not a studio one — it commits us to a new
serialized ordering concept and its whole round-trip, which deserves its own ADR
rather than riding along with the drag-to-reparent slice:

- A per-entity **sibling-order field** (a new component, or an order key on an
  existing one) with a reflection schema (CLAUDE.md §13), so order is authored
  state that survives a saved scene and a hot reload.
- Scene **serialization** must persist and restore that order (today `Children`
  order is discarded on load).
- `buildOutline` must sort by the order field instead of entity id.
- `hierarchy.reparent` (or a new `hierarchy.reorder` command) must assign/renumber
  the order key on drop, and the tree must render **drop-between-rows insertion
  lines** (not just whole-row reparent targets).

The reparent-only slice delivers most of the reorganization value now; ordering is
a separable follow-up. (Decision recorded with the user on 2026-07-04.)

## Acceptance

- An ADR seals the sibling-order representation (component/field, serialization,
  and the `buildOutline` sort change).
- Dragging a node between two siblings in the studio hierarchy sets its order, and
  that order survives a scene save + reload and a hot code reload.
- The tree shows an insertion line between rows during such a drag, distinct from
  the whole-row reparent highlight.
