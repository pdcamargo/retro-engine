# Engine `Name` component

- **Created:** 2026-06-01
- **Decision:** ADR-0057 (introduced here; reused by scenes/prefabs)

## Context

The engine has no entity-level name. glTF instantiation (ADR-0057) requires each node entity to carry
its glTF node name so the resulting tree is navigable (`findByName('eye')` to attach a camera to a
bone). The future scenes/prefabs system needs the same primitive. This item introduces a small,
general-purpose `Name` component.

## Why deferred

Tiny and standalone, but it is a shared engine primitive rather than glTF-specific, so it is its own
slice — landed before the glTF instantiation work that consumes it.

## Acceptance

- `packages/engine/src/name.ts` defines `class Name { value: string }` — a standalone value component
  with no `requires` and no hooks (nothing in engine core reads it; it is queried by consumers).
- Exported from `packages/engine/src/index.ts` alongside the other component exports.
- A test confirms it round-trips as a component (spawn with `Name`, query it back) and that introducing
  it does not perturb the existing component set.
- Lint, typecheck, test, build green; changeset added.
