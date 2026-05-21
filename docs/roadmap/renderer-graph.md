# Render Graph

- **Created:** 2026-05-21
- **Status:** Planning (do not start until ≥2 render passes exist)

## Goal

A Bevy-style render graph layer sits on top of `renderer-core`. Each pass declares its inputs and outputs (textures, buffers); the graph topologically sorts passes, allocates transient resources, and emits HAL command-encoder calls. Engine code authors render passes as plugins, not as ad-hoc procedural rendering.

## Phases

1. **Trigger condition.** We have ≥2 real passes (e.g. main color + post-process tonemap) that justify a graph. Until then, hand-orchestrated passes in `engine` are fine.
2. **Resource model** — graph-managed `Texture`/`Buffer` handles vs HAL-managed ones. Lifetime, reuse, aliasing.
3. **Pass declaration API** — TypeScript shape (function + descriptor object) and where it lives (`@retro-engine/render-graph`?).
4. **Scheduler** — topological order, dependency tracking, render-target reuse.
5. **Migration** — move existing engine rendering to use the graph; deprecate the direct-HAL path inside engine where appropriate.
6. **Debug tooling** — graph visualization in studio.

## Open questions

- Is the render graph a new package (`@retro-engine/render-graph`) or part of `engine`?
- Compute passes in the graph from day 1, or render-only first?
- Cross-frame resources (history textures for temporal AA, etc.) — how do they fit?
- Backend-specific graph optimizations: ignore for now; HAL handles them implicitly.

## Links

- ADR-0003 — renderer HAL
- Bevy render graph: https://bevy-cheatbook.github.io/graphics/render-graph.html
- Frostbite Frame Graph paper (background reading)
