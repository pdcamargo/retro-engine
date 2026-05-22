# ADR-0006: System Param Protocol

- **Status:** Accepted
- **Date:** 2026-05-22

## Context

After M1 the engine's `App.addSystem` is a two-arm overload — `SystemFn = (world) => void` for non-render stages, `RenderSystemFn = (world, ctx) => void` for the render stage. M2 introduces seven more param kinds the engine must inject into systems: `Res<T>` / `ResMut<T>`, multi-component `Query<[A, B]>` with `With` / `Without` / `Has` filters, `Commands` for deferred mutations, the stage-scoped render context, plus later `Local<T>` and `Trigger<E>`. Run conditions composing via `.and()` / `.or()` / `.not()` need a place to attach. Stacking another overload arm per param is not viable; Bevy resolves this in Rust with proc-macros over the function signature, which TypeScript has no equivalent of.

Four shapes were on the table: tuple-of-tokens beside the function, factory wrapping the function, decorator metadata on classes, and JSDoc-driven reflection. The single decision below names the chosen protocol and the locked sub-shapes (param interface, resolve context, system identity, run-condition class) every subsequent M2 phase will snap into.

Single-threaded throughout. There is no concurrency story anywhere in this ADR; param resolution and system invocation are sequential.

## Decision

Systems register through one signature:

```ts
app.addSystem(
  stage,
  params: readonly Param<unknown>[],
  fn: (...values) => void,
  options?: { runIf?: RunCondition },
);
```

The function receives the resolved param values, in order, and **nothing else** — no implicit `world` first argument. A system that needs the world adds an explicit `WorldRef: Param<World>` to its params.

The protocol's locked sub-shapes:

- **`Param<out T>`** — every param implements `{ resolve(ctx: ResolveCtx): T }`. Variance is `out T` so `infer T` binds tightly when TypeScript reconstructs the function-argument tuple from the param tuple. Optional `scope?: Stage` marker for stage-restricted params (today: `RenderCtx`); registration throws if a scoped param is used in the wrong stage.

- **`ResolveCtx`** — the locked context every param resolves against: `{ app, world, stage, systemId, render? }`. Frozen now so phase 6 (`Commands` per-system buffers), phase 5 (state-aware resolution), post-M2 (`Local<T>` per-system state, `Trigger<E>` event payloads) all already have what they need without widening the resolve signature.

- **`SystemId`** — internal monotonic `number & { readonly __brand: 'SystemId' }` minted per registered system. Not returned from `addSystem` (preserves `app.addSystem(...).addSystem(...)` chaining). Used by future phases to key per-system state — phase 5 `before` / `after` / `label` ordering, phase 6 `Commands` per-system queues, phase 8 plugin `cleanup`, post-M2 `Local<T>` lazy cells.

- **`RunCondition`** — a class, not a `Param`. Composable via `.and()` / `.or()` / `.not()`; `test(app): boolean` evaluates. Conditions gate execution at the stage runner (`if (sys.runIf && !sys.runIf.test(this)) continue`); they do not participate in param resolution. Phase 5 ships helper factories (`inState`, `resourceExists`, etc.); this ADR ships only the class.

- **Param-token interning.** Type-keyed factories (`Res(ctor)`, future `ResMut(ctor)`, `Query([…])`) cache their returned `Param` per key in a `WeakMap`. Per-system params (future `Local(init)`, scoped `Trigger`) construct fresh — their identity is per-system, not per-type. This identity model is what future schedule-graph dedup, observer hookup, and `Local<T>` slot-keying hang off.

### Rejected alternatives

- **Factory `system(...params, fn)`** — adds a wrapper indirection over the direct tuple form with no expressive benefit; variadic-with-trailing-fn inference is more fragile than tuple-then-fn under the `const` type-parameter modifier.
- **Decorator on class systems** — violates ADR-0001 composition-only (no class hierarchy in runtime code); ties params to class fields, complicating `Local<T>` semantics; standard-vs-legacy decorator ergonomics in TS are still unsettled.
- **JSDoc-driven reflection** — fragile, dependent on tooling that may not exist at the consumer's TS version; no runtime introspection without an extra parser dependency.

## Consequences

**Easier:**
- One `addSystem` signature across every present and planned stage, including future state schedules and `FixedUpdate`.
- New param kinds (`ResMut`, `Query`, `Commands`, `Local`, `Trigger`) extend by adding factories — no change to `addSystem` and no migration of existing systems.
- Run conditions compose as values, independent of param shape: `options.runIf: a.and(b).or(c.not())`.
- Per-slot inference works without explicit type args by combining `const Ps extends readonly Param<unknown>[]` with `out T` variance on `Param`.
- `ResolveCtx` and `SystemId` give every future param a place to live without protocol churn.

**Harder:**
- A stage-scoped param used in the wrong stage errors at app construction, not at compile time. The single-line runtime check is small enough that compile-time enforcement (per-stage `Param` brands + per-stage `addSystem` overloads) is not worth the type-system complexity.
- Every system declares its params explicitly. Plugin code that today reaches `app.renderer` via closure still works, but the canonical style going forward is "everything the system reads or writes is in its `params`".
- Each registered system carries a `SystemId` even when no consumer yet asks. The memory cost is one number per system; the upside is no protocol break when phases 5, 6, 8 land.

## Implementation

- `packages/engine/src/system-param.ts` — `Param`, `ResolveCtx`, `SystemId`, `RenderCtx`, `Res`, `RunCondition`
- `packages/engine/src/index.ts` — `App.addSystem`, `App.insertResource`, `App.getResource`, frame-loop resolver
- `packages/engine/src/index.test.ts` — protocol tests (zero-param, `Res<Foo>`, `RenderCtx`, `runIf` gate, stage-scope check)
- `packages/ecs/src/index.ts` — removed unused `System` type alias
- `apps/playground/src/triangle-plugin.ts` — migrated to the new shape
- `apps/studio/src/main.ts` — migrated to the new shape
