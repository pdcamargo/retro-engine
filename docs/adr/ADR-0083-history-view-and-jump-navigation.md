# ADR-0083: History view and jump navigation

- **Status:** Accepted
- **Date:** 2026-06-17

## Context

ADR-0082 shipped `History` — linear past/future command stacks with undo/redo,
coalescing, and batches — and a read surface (`entries()` → past labels only) sized for
a tooltip, plus `canUndo`/`canRedo`. It explicitly deferred a dedicated history-panel UI
to the backlog.

That panel needs more than ADR-0082 exposes. A design handoff specifies a Photoshop-style
timeline: every state oldest→newest with the **redoable tail** shown (dimmed), a marker on
the **current** state, **click any row to jump** there, and per-row category tint + target
+ delta. `entries()` returns only the applied past, only labels, with no cursor and no
jump — so the panel's defining interaction and its dim tail cannot be built on it. The
panel must also not reach into `History`'s private stacks.

A second mismatch: the handoff is a DOM/CSS/React prototype, but the studio UI is Dear
ImGui drawn to a WebGPU canvas (ADR-0030 / the editor-sdk shell). There is no DOM to port;
the panel is reimplemented in immediate-mode draw calls.

## Decision

Extend `History` **additively** — `entries()` and `HistoryEntrySummary` are unchanged for
back-compat — with a read + navigation surface a view binds to:

- `view(): HistoryView` returns the full timeline oldest-first (applied past, then the
  redoable future) and `currentIndex`, the cursor at the live state (`-1` when empty). A
  pending mid-drag edit is not yet an entry and does not appear.
- `jumpTo(index)` moves the world to the state that index addresses, stepping undo/redo as
  many entries as needed (reusing the existing revert/apply logic), clamped to the
  timeline, firing `onChange` at most once for the whole jump.
- Each `HistoryEntryView` carries a `label`, a category (`HistoryEntryKind`), and — for
  single-command entries — the `entity`/`componentName`, plus the edited `field` and
  `before`/`after` for `setField`. That is the minimum a view needs; **presentation (icon,
  tone, target name, delta string) is derived in the panel, not stored on commands.** No
  timestamps are captured — the handoff's time-ago column is optional and is left out.

The panel itself (`apps/studio/src/panels-history.ts`) is an ImGui reimplementation of the
handoff: a lane-0 rail with node dots, a glowing current node, a dimmed dashed redo tail,
a current-row accent background + inset rail, tone-tinted action icons, an in-body header
(undo/redo/clear), and a footer step count. It reads `view()` each frame, calls
`jumpTo`/`undo`/`redo`, and resolves target names live from the `Name` component.
**Linear only** — branching is out of scope.

This is additive to ADR-0082, not a reversal; ADR-0082 stands unchanged.

## Consequences

- The panel is a pure view over a small, stable surface; it owns presentation, so it grows
  richer for free as more action sources (spawn/delete entity, paint, scene load) start
  routing through `History` — no view changes required.
- `view()` rebuilds a bounded array (≤ `History` capacity, default 200) each frame the
  panel is visible; this is view-layer work outside the engine frame loop, so no benchmark
  is warranted. `jumpTo` is O(distance) undo/redo, correct by reuse.
- No time-ago column without a later push-time timestamp capture (a small additive
  follow-up if wanted).
- Branching (divergent edit trees) remains unsupported: it would require reworking
  `History` from linear stacks into a parent/lane graph and adding a cubic-bezier draw
  primitive (the `Draw` facade has lines/circles/rects only). A separate future ADR.

## Implementation

- `packages/editor-sdk/src/edit/history.ts` — `History.view`, `History.jumpTo`,
  `HistoryView`, `HistoryEntryView`, `HistoryEntryKind` (additive to ADR-0082's `History`)
- `packages/editor-sdk/src/index.ts` — re-exports the new types
- `apps/studio/src/panels-history.ts` — `historyPanel`
- `apps/studio/src/history-clear-dialog.ts` — `historyClearDialog`
- `apps/studio/src/main.ts`, `apps/studio/src/chrome.ts` (Edit ▸ Clear History + `drawDialogs`),
  `apps/studio/src/state.ts` (`historyLastCurrent`, `historyClearConfirm`) — studio wiring
