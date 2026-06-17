# Inspector — history panel UI

A dedicated dockable panel listing the undo/redo stack: each `History` entry by
label, the current cursor between past/future, click-to-jump, and a clear button.

The data is already there — `History.entries()` returns ordered
`HistoryEntrySummary` labels and `canUndo`/`canRedo` expose the cursor (ADR-0082).
This is purely the view: a panel def under `apps/studio` that renders the list and
calls `undo`/`redo`. Deferred from the inspector slice as polish; undo/redo itself
works via shortcuts and the Edit menu.
