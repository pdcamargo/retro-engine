---
'@retro-engine/editor-mcp': minor
'@retro-engine/graph-editor': minor
---

feat(editor-mcp): graph.* commands + GraphHost

`@retro-engine/graph-editor` gains a `GraphHost` — a shared registry of open
graph documents (keyed by GUID) plus the environment they're authored against —
registered as an App resource so the editor panel and the MCP layer operate on
the same document.

`@retro-engine/editor-mcp` adds the `graph.*` command set: `describe` (kinds /
node types / data types / categories), `get`, and the mutating `addNode` /
`moveNode` / `connect` / `disconnect` / `addReroute` / `removeReroute` /
`setField` / `deleteNode` / `setActive`. `connect` validates against the kind's
rules. Mutations route through the editor `History` as undoable snapshot-commands
(ADR-0139) and are recorded in the audit ring.
