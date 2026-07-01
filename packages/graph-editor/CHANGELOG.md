# @retro-engine/graph-editor

## 0.1.0

### Minor Changes

- a39203c: feat(editor-mcp): graph.\* commands + GraphHost

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

- a0f614e: feat(graph-editor): reusable node-graph editor toolkit — package scaffold

  New package `@retro-engine/graph-editor`: a reusable immediate-mode node-graph
  editing toolkit for the studio, built on `@retro-engine/editor-sdk` + `@retro-engine/math`.
  One editor component renders and edits any node graph (dataflow, exec-flow, state
  machines, context stacks, subgraphs) with typed pins, source-colored bezier wires,
  reroute weight-points, and embedded fields; consumers register their own graph kinds
  and drive it over MCP. Per ADR-0137 (architecture) and ADR-0138 (draw primitives +
  edit-scope reuse).

  This changeset covers the package scaffold + sealed architecture; model, registries,
  rendering, interaction, serialization, MCP commands, and the studio demo panel land
  in the phased roadmap (`docs/roadmap/graph-editor.md`).

### Patch Changes

- Updated dependencies [6ce8fae]
- Updated dependencies [952766f]
- Updated dependencies [d4b6766]
- Updated dependencies [01e2615]
- Updated dependencies [7e26e59]
- Updated dependencies [5d7a21a]
- Updated dependencies [9e2aaf5]
- Updated dependencies [dc943f5]
- Updated dependencies [77f0ed5]
- Updated dependencies [2abd75c]
- Updated dependencies [3df2cb6]
- Updated dependencies [0625db9]
- Updated dependencies [4c93e0b]
- Updated dependencies [fad8a5e]
- Updated dependencies [7a1d32c]
- Updated dependencies [0eca147]
- Updated dependencies [ecfc0e3]
- Updated dependencies [e97fdd2]
- Updated dependencies [92d6c91]
- Updated dependencies [f8079c6]
- Updated dependencies [1b98dc4]
- Updated dependencies [ae68f06]
- Updated dependencies [73fdef4]
- Updated dependencies [acae153]
- Updated dependencies [05b372f]
- Updated dependencies [5cf81f9]
  - @retro-engine/editor-sdk@0.1.0
  - @retro-engine/math@0.1.0
