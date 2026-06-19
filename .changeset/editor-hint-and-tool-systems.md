---
'@retro-engine/project': minor
---

feat(project): `isEditorHint()` + `runInEditor()` for tool systems (ADR-0098)

Run user code in the editor while the game isn't playing — Godot `@tool` / Unity
`[ExecuteAlways]` for Retro Engine:

- `isEditorHint()` — true inside the studio (Edit or Play), false in a standalone
  runtime. Branch editor-only behavior (preview/gizmos) vs game logic.
- `runInEditor(systemFn)` — tags a system so the studio's play-state gate skips it; it
  runs in Edit as well as Play. Returns the same function for inline use. Inert (no-op)
  in a standalone runtime, so the same code runs in both.
- `isRunInEditor(fn)` — host-side predicate the studio reads; not needed by game code.

The engine stays editor-agnostic: the hint is a global the studio sets, the tag is a
project-package symbol.
