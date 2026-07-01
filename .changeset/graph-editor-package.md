---
'@retro-engine/graph-editor': minor
---

feat(graph-editor): reusable node-graph editor toolkit — package scaffold

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
