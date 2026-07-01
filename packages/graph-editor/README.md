# @retro-engine/graph-editor

A reusable immediate-mode node-graph editing toolkit for the Retro Engine studio.

One editor component renders and edits any node graph — dataflow (shader /
material), exec-flow blueprints, state machines, VFX context stacks, and
subgraphs. It is built on `@retro-engine/editor-sdk` (Dear ImGui via jsimgui) and
exposed as a public SDK so consumers can author their own node types **and their
own graph kinds**, and drive the editor over MCP.

## Concepts

- **`GraphDocument`** — the generic, headless, serializable graph model (nodes,
  edges, reroute weight-points, groups). Consumers map their runtime graph
  to/from it; the toolkit never imports consumer runtime types.
- **`GraphEnvironment`** — owns the registries: a global `DataTypeRegistry` +
  `CategoryRegistry` (shared color language) and per-kind `NodeTypeRegistry` +
  connection rules. A `GraphKind` references data types by id.
- **`GraphView`** — transient per-view state: pan/zoom, selection, interaction.
- **`GraphTheme`** — the typed-pin/wire/category colors + geometry tokens;
  runtime-overridable.

## Status

Under construction. See the roadmap for phased delivery.
