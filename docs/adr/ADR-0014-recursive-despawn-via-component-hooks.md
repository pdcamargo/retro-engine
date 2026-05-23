# ADR-0014: Recursive Despawn via Component Hooks

- **Status:** Accepted
- **Date:** 2026-05-23
- **Supersedes:** ADR-0010 (in part — §3 despawn semantics and §7 `despawnRecursive` mechanics)

## Context

ADR-0010 §3 established a single-entity despawn contract: `cmd.entity(e).despawn()` removes only the named entity, and a separate `cmd.entity(e).despawnRecursive()` walks `Children` to cascade. The reason was explicit at the time: "observers (Bevy's `OnRemove<Parent>` model) are M3 territory and will revisit auto-cascade with proper machinery in place."

That machinery arrived in ADR-0013: component hooks (`onAdd` / `onInsert` / `onReplace` / `onRemove`), observers, `Message<T>`. §16 deferred the recursive-despawn migration to a follow-up slice and §11 pre-locked observer-before-hook ordering so the follow-up could ship as a pure consumer.

This is that follow-up. With the hook surface in place, the cascade can be driven from a one-line registration in `CorePlugin`; the manual `Children` walk in `applyCommandOp`'s `despawnSubtree` arm is no longer the right shape. Plain `cmd.despawn(e)` becomes always-cascade (Bevy 0.5+ default), matching the surrounding ecosystem and removing the per-call-site decision of "did I remember to use the recursive variant."

A second, smaller behavioural concern surfaces: today's `despawnSubtree` arm explicitly splices the dying root out of its parent's `Children.entities` list (`commands.ts:298–305`). Plain `despawn` has never done this — a child despawned via `cmd.despawn` leaves a dangling entry in the parent's `Children`. The dangling entry is tolerated by `propagateTransforms` (which depends only on `Parent`, not `Children`) and by the `despawnSubtree` walk itself (`if (!hasEntity(child)) continue`), but it is still a coherence wart and an asymmetry between the two despawn paths.

## Decision

Two component hooks, both registered in `CorePlugin`, both keyed to `onRemove`:

1. **`onRemove(Children)` drives the cascade.** Body iterates `value.entities`, guards each against `world.hasEntity`, and enqueues `commands.despawn(child)` for live descendants. Each enqueued op fires `applyDespawnWithHooks` later in the same flush, recursively triggering the next layer's `onRemove(Children)`. ADR-0013 §10's `MAX_TRIGGER_DEPTH = 8` is scoped to trigger ops only and does not interact with this chain; arbitrarily deep hierarchies cascade without spurious devWarn.

2. **`onRemove(Parent)` drives parent-detach.** Body splices the dying entity out of its parent's `Children.entities` (guarded by `world.hasEntity(parent)`). Reparenting does not fire this hook: `appendChild` mutates `oldChildren.entities` via direct splice and reuses the existing `Parent` instance in-place — neither path routes through `applyRemoveWithHooks`. Despawn does, because `applyDespawnWithHooks` fans `onRemove` over every component on the entity.

Both hooks are orthogonal in purpose — the first walks down, the second points up — and they compose cleanly: cascading despawn of a parent fires Children's hook on the parent (cascade down) and Parent's hook on each child as the child itself is despawned (parent-detach, no-op against the already-dead parent thanks to the `hasEntity` guard).

The `despawnSubtree` CommandOp variant is removed. `EntityCommands.despawnRecursive()` enqueues plain `{ kind: 'despawn', entity }`; the named method survives as a call-site intent signal but shares the code path with `.despawn()`.

`cmd.entity(e).despawn()` now always cascades through `Children` and detaches from the parent's `Children` list. This is a behavioural change to a public surface (the supersede of ADR-0010 §3, §7) and is captured in the engine changeset as a minor bump.

## Consequences

**Easier:**

- One despawn semantic. Call-site authors no longer choose between `.despawn` and `.despawnRecursive` based on whether the entity has children — the choice doesn't matter.
- Plain `cmd.despawn(child)` cleans up the parent's `Children.entities`. Strict improvement over today's dangling-entry behaviour, removes a footgun that `propagateTransforms`-only consumers wouldn't have noticed.
- The recursive-despawn implementation lives in two `~10-line` hook bodies in `CorePlugin` rather than in a `~28-line` switch arm. Easier to reason about; easier to override (a consumer that wants different cascade semantics can register their own hook — at the cost of competing-registration ordering, which is documented in ADR-0013 §12).
- One fewer `CommandOp` variant.

**Harder:**

- Behavioural change to `cmd.despawn`. Pre-existing consumers who relied on "plain despawn leaves children alive as orphans" need to opt in explicitly. The escape hatch is `cmd.entity(parent).removeChild(child)` to detach before despawn, or direct `world.despawn` (which never fired hooks per ADR-0013). Pre-0.1.0; no external consumers exist.
- Two simultaneous hook chains (Children cascading down, Parent detaching upward) interact during cascade. The interaction is benign — Parent's hook is a no-op once the parent is dead — but it is more dispatch work per cascaded entity. Hot-path impact is `Map.get` per entity per `onRemove` kind, which is microsecond-cheap at any realistic N.

**Accepted trade-offs:**

- Direct `world.despawn(e)` calls (outside Commands) still don't cascade or detach — consistent with ADR-0013's "world stays app-ignorant" rule. Test code that needs cascade routes through `Commands`. The existing orphan-handling test (`hierarchy.test.ts:254`) intentionally exploits this path to produce a controlled orphan.
- The `detachChild` arm's explicit `Children.entities.splice` (`commands.ts:282–286`) is now redundant with `onRemove(Parent)` for the case where `applyRemoveWithHooks` fires. It is kept because the arm's race-defence gates `applyRemoveWithHooks` on `childParent.entity === op.parent`; the explicit splice is still load-bearing when the gate skips. The redundancy is a no-op (`indexOf` returns `-1` the second time).

## Rejected alternatives

- **Cascade via `onRemove(Parent)`.** Wrong direction: a child losing its `Parent` component does not imply the parent is dying. `onRemove(Parent)` is the right hook for parent-detach, not cascade.
- **Cascade hook only; keep `despawnSubtree` arm for parent-detach.** Two code paths for what is now one behavioural concept, plus the arm becomes vestigial (it would only run via `despawnRecursive` which we want to alias to plain despawn). The whole point of this migration is to collapse to one path.
- **Opt-in cascade via `despawnRecursive` only (preserve ADR-0010 §3).** Was the right call before the hook surface existed. With the surface in place, the workaround is no longer justified and the asymmetry (does plain despawn cascade? sometimes? only if children?) is a footgun.
- **Skip the `onRemove(Parent)` registration and accept dangling refs on plain despawn.** Would silently break the existing `despawnRecursive` parent-detach assertion (`commands.test.ts:687–709`) and re-introduce a coherence gap between the two despawn paths.
- **Promote to a `HierarchyPlugin`.** Premature. `CorePlugin` is 45 LOC; two ~10-line hook bodies fit comfortably. Promote when hierarchy responsibilities grow further (e.g. when `Changed<Transform>`-gated propagation lands per ADR-0012 §8).

## Implementation

- `packages/engine/src/core-plugin.ts` — `CorePlugin.build()` registers `onRemove(Children)` (cascade) and `onRemove(Parent)` (parent-detach) via `app.registerComponentHook`.
- `packages/engine/src/commands.ts` — `CommandOp` union loses `'despawnSubtree'`. `applyCommandOp` loses its `case 'despawnSubtree'` arm. `EntityCommands.despawnRecursive` enqueues `{ kind: 'despawn', entity: this.id }`.
- `packages/engine/src/hierarchy.ts` — `Parent` and `Children` TSDoc updated to reflect the new always-cascade default.
- `packages/engine/src/component-hooks.test.ts` — new tests for direct consumer registration of `onRemove(Children)` (cascade) and `onRemove(Parent)` (parent-detach).
- `packages/engine/src/commands.test.ts` — new test asserting plain `cmd.despawn(parent)` cascades through `Children`. Existing `despawnRecursive` tests pass unchanged.
- `docs/adr/ADR-0010-transform-and-hierarchy.md` — `Status:` flipped to "Superseded in part by ADR-0014". Body frozen.
