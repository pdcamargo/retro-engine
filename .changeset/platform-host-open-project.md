---
'@retro-engine/editor-platform': minor
---

feat(editor-platform): add optional `PlatformHost.openProject` (ADR-0093)

`PlatformHost` gains an optional `openProject(): Promise<string | null>` — a native
folder picker that returns the chosen project directory, present only when the
`dialogs` + `filesystem` capabilities are true (absent in a plain browser). Dep-free
(returns a path string), so the package stays a leaf.
