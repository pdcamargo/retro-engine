# Nested-scene per-instance overrides

- **Created:** 2026-06-12

## Context

Scene composition (ADR-0071) ships the live nested-scene link: a mount entity references a child scene by GUID, the child is instantiated under it, the same child can be instanced many times, and each instance is named and positioned by its mount's own components. What it does **not** yet do is let a parent override a field on an entity *inside* a nested child for a single instance — Godot's "editable children" / Unity's prefab-instance overrides. Example: two rooms come from the same `Room` scene, but one instance's door is `locked` and the other's is `open`, where `locked` lives on a door entity inside the `Room` scene.

ADR-0067 named this as "a future ADR with a provenance component"; ADR-0071 confirmed it as the deliberately-deferred follow-up. It is the capability that most directly serves the editor (instance-level tweaks without forking the child asset).

## Why deferred

Doing it robustly needs design that ADR-0071 chose not to rush:

- **Addressing into the child.** Overrides must target a descendant entity by a stable, re-author-safe path (a name-path / relationship chain), **not** the child's internal numeric scene-ids, which shift when the child `.scene` is edited. That addressing layer does not exist yet.
- **Override-vs-inherit provenance.** Each overridden field must be tracked as "set by this instance" vs "inherited from the child," so re-saving the parent re-emits only the overrides (not a baked copy) and an un-overridden field still picks up later edits to the child — preserving the live link. This is a new provenance component on instantiated nested entities.
- **Interaction with the reactor's lazy, depth-incremental instantiation** (overrides apply after the child spawns, a frame or more later) and with teardown.

None of these block the composition slice itself; they are a separable layer best built when an editor consumer drives the addressing/provenance shape.

## Acceptance

- A scene's `scene` ref can carry per-instance overrides addressing descendant entities of the child by a stable, re-author-safe path.
- Applying a nested scene with overrides leaves non-overridden fields tracking the child asset (edit the child → un-overridden fields change in every instance; overridden fields stay pinned).
- Saving a composed scene re-emits only the overrides (plus the `scene` ref), never a baked expansion of the child.
- Round-trip + override-vs-inherit + re-author-shift-safety are covered by tests; a playground device check shows two instances of one child scene differing by an override.
- A new ADR records the addressing + provenance decision (supersedes nothing; builds on ADR-0071).
- Lint, typecheck, test, build, and bench are green.
