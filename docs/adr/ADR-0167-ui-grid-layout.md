# ADR-0167: UI grid layout (pure-TS, behind the LayoutEngine seam)

- **Status:** Accepted
- **Date:** 2026-07-07

## Context

The UI ships a flexbox `LayoutEngine` (`FlexLayoutEngine`); the `LayoutEngine`
interface was designed swappable "so a game can pick flexbox now and (later) CSS
grid or a WASM engine." Grid is the natural second layout mode — 2D placement
(inventory panels, HUD dashboards, tile menus) that flexbox only approximates.
The roadmap wants it "pure-TS behind the `LayoutEngine` interface (Taffy-WASM
only as a fallback escape hatch)."

Grid is a large spec (track sizing with `px`/`fr`/`auto`/`minmax`, explicit +
auto placement, spanning, alignment). Landing it all at once is a big, risky
change that also has to touch `UiStyle` (new `display`/`grid-template` fields) and
the layout-engine tree walk (per-node `display` dispatch). The question is how to
sequence it.

## Decision

Build grid **core-first, pure**: the track-sizing + cell-geometry algorithm ships
as a standalone module now, and the `UiStyle` fields + `LayoutEngine` integration
(display-dispatch, placing children into cells) follow as later phases.

- **`GridTrack`** — `{ kind: 'px', value }` or `{ kind: 'fr', value }`. `fr`
  distributes the leftover space (after fixed tracks + gaps) in proportion to its
  fraction, clamped at zero. `auto` / `minmax` / content sizing are deferred (they
  need the child intrinsic-measure hook the flex engine already has, so they land
  with the tree integration).
- **`resolveGridTracks(tracks, available, gap)`** — the 1D track solver
  (px reserve → gap reserve → fr split), pure and axis-agnostic (used for both
  columns and rows).
- **`computeGridLayout(spec, available)`** — resolves column + row tracks and
  emits one `LayoutRect` per cell, row-major, offset by running track sizes + gaps.
  Pure, `LayoutEngine`-shaped (`LayoutRect`), independent of the ECS.
- **Why standalone-first.** The track solver + cell geometry is the substantive,
  self-contained algorithm; proving it in isolation (fr distribution, gaps,
  over-full clamping, cell offsets) de-risks the later tree integration and gives
  a reusable core. It composes with the existing engine rather than replacing it —
  a `display: grid` node will call `computeGridLayout` for its content box and lay
  its children into the returned cells, exactly as the flex node computes a flex
  line.

## Consequences

- The grid geometry is testable and correct before any `UiStyle` / ECS change,
  keeping the eventual integration a wiring step, not an algorithm + wiring step.
- Grid and flex coexist per-node (the CSS model) once `display` dispatch lands —
  not a whole-tree engine swap — so a flex HUD can contain a grid inventory.
- **Deferred (later phases):** `UiStyle` `display` + `gridTemplateColumns/Rows` +
  `gap` (row/col) fields; the `LayoutEngine` display-dispatch that places children
  into cells (with per-item span / explicit placement); `auto` / `minmax` tracks;
  grid-level alignment (`justify/align-items/content`). Taffy-WASM remains only a
  fallback escape hatch, not the path.

## Implementation

- `packages/ui/src/grid-layout.ts` — `GridTrack`, `GridSpec`, `GridLayout`,
  `resolveGridTracks`, `computeGridLayout`.
