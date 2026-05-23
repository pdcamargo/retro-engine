---
'@retro-engine/engine': minor
---

feat(engine): lifecycle-as-trigger sugar — `Lifecycle.onAdd/onInsert/onReplace/onRemove(Comp)` (ADR-0015)

Component mutations are now observable through the same `Trigger<E>` / observer surface that gameplay events already use. Four factory entrypoints under a new `Lifecycle` namespace:

```ts
class Sprite { constructor(public src: string) {} }

// Global observer for every Sprite that lands on an entity.
app.addObserver(
  Lifecycle.onAdd(Sprite),
  [Trigger(Lifecycle.onAdd(Sprite))],
  (t) => console.log(`sprite ${t.event().value.src} on entity ${t.entity()}`),
);

// Entity-targeted observer — fires only for the bound entity, dropped on despawn.
cmd.spawn(new Sprite('hero.png'))
  .observe(Lifecycle.onRemove(Sprite), [Trigger(Lifecycle.onRemove(Sprite))], (t) => {
    saveSpriteSlot(t.event().value);
  });
```

Each `Lifecycle.onX(Comp)` call returns a stable, cached synthetic class per `(kind, componentCtor)` pair — `Lifecycle.onAdd(Sprite) === Lifecycle.onAdd(Sprite)`. The class is directly usable as the event-key for `app.addObserver`, `commands.entity(e).observe`, and `Trigger(...)`.

**Observer-before-hook ordering (ADR-0013 §11).** For any `(kind, type)` that has both an observer and a component hook registered, the observer fires first. Lets consumers inspect lifecycle moments before the engine's own hooks run — most notably, a `Lifecycle.onRemove(Children)` observer fires before `CorePlugin`'s cascade hook tears the subtree down (ADR-0014).

**Event payload shape:** `LifecycleEvent<T>` carries `{ entity, value }`, mirroring `HookCtx<T>`. `value` semantics match the hook of the same kind — just-installed for `onAdd` / `onInsert`, OLD value for `onReplace`, about-to-be-removed for `onRemove`.

**Depth handling:** lifecycle dispatch is inline — it does not consume `MAX_TRIGGER_DEPTH` slots. A lifecycle observer can call `cmd.spawn(...)` to chain into more lifecycle dispatches; the chain self-terminates the same way ADR-0014's cascade does. `cmd.trigger(...)` calls inside a lifecycle observer still increment depth and remain subject to the cap.

**API surface (additive, no breakage):**

- `Lifecycle` (value) and `LifecycleEvent<T>` (type) — new exports from `@retro-engine/engine`.
- Internal: `apply*WithHooks` helpers swap `CommandsHandle` for `SystemId` in their signatures (engine-private, not on the consumer surface).

**ADR provenance:**

- Seals ADR-0015.
- Consumes ADR-0013 §11 (observer-before-hook ordering) and §15 (hook payload semantics) as a pure consumer — ADR-0013's body stays frozen per CLAUDE.md §3.
- Composes with ADR-0014's cascade: the cascade moment is now observable without modifying `CorePlugin`.
