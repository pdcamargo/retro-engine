# ADR-0005: ECS Archetype Storage

- **Status:** Accepted
- **Date:** 2026-05-21

## Context

The engine's ECS is its hot path: every frame iterates components across many entities. Two dominant storage models exist:

1. **Archetype-based** (Bevy, Flecs default, Unity DOTS) — entities are grouped by their exact component set into archetype tables; component data lives as parallel columns. Multi-component queries iterate contiguous arrays per archetype, which is cache-friendly. Adding/removing a component moves the entity between archetypes (a real cost).
2. **Sparse-set** (EnTT, bevy_ecs's earlier versions) — each component type owns a sparse-set indexed by entity ID. Structural changes (add/remove) are O(1) and cheap; multi-component iteration is good but not as cache-tight as archetype scans at scale.

Retro Engine is inspired by Bevy and targets a Bevy-shaped developer experience. Performance under many entities and many queries is a primary goal.

## Decision

The ECS uses **archetype-based storage**.

- Entities are opaque numeric IDs.
- Each combination of component types is an `Archetype`. Data is stored as parallel columns (`Component[]`) keyed by component type.
- Queries are compiled to a list of matching archetypes and iterate each archetype's columns linearly.
- Structural changes (add/remove component) move the entity row between archetypes. We accept this cost.

Storage implementation is deferred — day 1 ships a stub `World` with the public surface (`spawn`, `despawn`, `addComponent`, `removeComponent`, `query`) and a simple backing store sufficient to make a few entities round-trip. Real archetype storage lands per [`docs/roadmap/ecs-storage.md`](../roadmap/ecs-storage.md).

## Consequences

**Easier:**
- Iteration performance matches Bevy's design center.
- Mental model maps directly to Bevy docs and tutorials, which we'll lean on for plugin/system design.
- Query planning is centralized.

**Harder:**
- Implementation complexity is concentrated in the storage and query-planner code. Bugs there are subtle.
- Code that adds/removes components in hot loops can perform poorly (archetype transitions). We may need to add deferred command buffers, matching Bevy.
- Editor-time code (high churn of structural changes) is the worst case for archetypes. We may need a sparse-set fallback for editor-only metadata; if so, that becomes a new ADR.

## Implementation

- `packages/ecs/src/index.ts` — `World`, `Entity`, `Component`, `Query`, `System`
- (Real archetype storage to land per roadmap.)
