---
'@retro-engine/editor-sdk': minor
---

feat(editor-sdk): history view + jump navigation for the studio history panel (ADR-0083)

Adds an additive read + navigation surface to `History`, sized for a dedicated undo/redo timeline UI. `entries()` and `HistoryEntrySummary` are unchanged.

**New public surface:**

- `History.view()` → `HistoryView` — the full timeline oldest-first (applied past, then the redoable future) plus `currentIndex`, the cursor at the live state (`-1` when empty). A pending mid-drag edit does not appear until it commits.
- `History.jumpTo(index)` — moves the world to the state at `index`, stepping undo/redo as needed, clamped to the timeline, firing `onChange` at most once for the whole jump.
- `HistoryEntryView` / `HistoryEntryKind` — a per-entry view carrying label + category and, for single-command entries, the target (`entity` / `componentName`) plus the edited `field` and `before`/`after` for `setField`. Enough for a view to derive its icon, tone, target name, and delta; presentation is not stored on commands.

The studio gains a HISTORY panel built on this (git-style rail, glowing current node, dimmed redo tail, click-to-jump, header undo/redo/clear, footer step count) — that panel lives in the unpublished `apps/studio` and is not part of this package's surface. No timestamps are captured (the optional time-ago column is left out); branching remains unsupported.
