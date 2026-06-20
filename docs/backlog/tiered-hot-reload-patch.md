# Tiered hot reload — live body-patch tier (Edit-and-Continue)

- **Created:** 2026-06-20

## Context

ADR-0102 shipped hot code reload as a single strategy: rebuild the whole project, swap its
plugins, and serialize → respawn the user scene. That is correct and, for small scenes,
sub-frame — but it always tears the world down and rebuilds it, even when the only thing that
changed was the body of one system.

The aspiration (think Unity's "Hot Reload" asset, which patches IL method bodies live and
falls back to a domain reload for structural changes) is a **tiered** system: apply the
*minimal* update a change needs. This file captures the design while it's fresh; it is a
future enhancement, not planned work yet.

## The tiers

1. **Body patch (Edit-and-Continue).** Only a system's *logic* changed. A system here is a
   free function `(world) => {…}`, so the update is: replace that function on the live schedule
   and keep running — no despawn/respawn. Equivalent to Unity patching a method body.
2. **Data-shape change.** A component's fields changed (added / removed / retyped). The
   reflection codec already migrates this on decode, so serialize → respawn preserves the data.
   This is today's path (ADR-0102) and stays the fallback.
3. **Structural.** New / removed components, systems, or plugins → full plugin swap + respawn.
   Today's path.

**Tier selection** is tractable with machinery we already have: build the rebuilt module into a
*scratch* App (no side effects), introspect its registrations (`captureBaseline` /
`buildCodeIndex`), and diff against the live App — same component schemas (by name + field
kinds) and same system set (by label / stage / params) with only the function objects
differing → Tier 1; schemas differ → Tier 2; types/systems added or removed → Tier 3.

## The hard part: class identity in JS

Re-evaluating a module produces **new** class objects. A new system's `Query([Health])`
references the *new* `Health`, which won't match entities still holding the *old* `Health` — so
naively "swap only the function" breaks. Tier 1 therefore needs a **reconciliation loader**:
on rebuild, reuse the existing class objects for structurally-unchanged components and swap
only the function bodies on the live schedule (a `StageSystems.replaceFn(predicate, fn)`).
This is the React-Fast-Refresh / Vite-HMR pattern; it is the real engineering cost. Bun's
`import.meta.hot` can supply per-module change granularity to drive the diff, but it does not
solve class identity on its own — the accept/reconcile logic is still ours to write.

**Why our ECS makes Tier 1 more achievable than Unity's model:** logic lives in systems (free
functions), data lives in components (no methods, CLAUDE.md §5). Unity must patch methods *on*
the same types that hold state; we only swap pure functions and leave the data classes
untouched — which is exactly the precondition Tier 1 needs, and we already enforce it.

## Play-mode policy (resolved)

Losing world state on a structural reload **during Play is acceptable and expected** — Play
state is already discarded when you stop playing. So Tier 2/3 do **not** need to gate to Edit
mode or prompt before clobbering Play state; respawn-anytime is fine. Tier 1's value is then
purely snappiness: instant, churn-free logic tweaks (in Edit or Play) without a respawn — not
state preservation.

## Scope when picked up

- A reconciliation loader that preserves component-class identity across rebuilds for
  structurally-unchanged components, and surfaces the rebuilt system functions.
- `StageSystems.replaceFn` (or equivalent) to swap a live system's body in place.
- The build-into-scratch + diff tier-selector, reusing `captureBaseline` / `buildCodeIndex`.
- Edge cases: systems closing over module-level state, observers / component hooks (which
  ADR-0102 already defers removing — see `hot-reload-observer-hook-removal.md`), and param
  changes (a changed `Query`/`Res` signature is structural, not a body patch).

## Acceptance

- Editing only a system's body updates its behavior live (Edit or Play) with no respawn and no
  visible churn — existing entities and their data are untouched.
- A field or type change still round-trips correctly through the Tier 2/3 respawn.
- The tier is chosen automatically from the diff; a change that isn't a clean body patch falls
  back safely to respawn.
