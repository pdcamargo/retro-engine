# Prefab templates and patches

- **Created:** 2026-06-03

## Context

`scenes-and-prefabs.md` phases 2–3. A **template** is a reusable entity prototype — a component bundle with named parameters (`Player = [Transform, Sprite('player.png'), Health(100)]`) — spawnable as a fresh entity (`spawn(Player, { health: 200 })`) or applied as a **patch** to an existing entity (add the "Damaged" visuals without rebuilding it). BSN's core idea, adapted to our archetype World + the reflection registry. Spawning uses the M2 Required Components mechanism: the definition lists explicit components, and requires fill in the rest.

## Why deferred

Sequenced after the scene-as-asset + lifecycle slice: templates are referenced by and embedded in scenes, so the scene format and spawn path should land first. Patch override semantics are an open question (one-shot at spawn vs persistent override — see `scenes-and-prefabs.md`); locking that needs a real consumer. Builds directly on the registry + `spawnScene` mechanics from ADR-0061 and the glTF instantiation precedent (ADR-0057).

## Acceptance

- A template defines a parameterised component bundle; spawning it produces an entity with params substituted and Required Components resolved.
- The same template applied as a patch mutates an existing entity rather than spawning a new one.
- Override semantics (one-shot vs persistent) are decided and documented.
