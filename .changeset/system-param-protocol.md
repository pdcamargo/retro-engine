---
'@retro-engine/engine': minor
'@retro-engine/ecs': minor
---

System param protocol: `App.addSystem` now takes a tuple of param tokens plus a value-receiving function, with optional `runIf` run condition. Sealed as ADR-0006.

- `packages/engine` exports `Param`, `ResolveCtx`, `SystemId`, `RenderCtx`, `Res`, `RunCondition`, `ParamValues`. Phase 1 ships `RenderCtx` (stage-scoped to `'render'`) and `Res(ctor)` against a minimal resource registry on `App` (`insertResource`, `getResource`).
- `SystemFn` and `RenderSystemFn` types removed; the old `addSystem` overload pair is replaced by one signature: `addSystem(stage, params, fn, options?)`.
- `packages/ecs` removes the unused `System` type alias.

Migration: `addSystem('startup', () => {...})` → `addSystem('startup', [], () => {...})`. `addSystem('render', (world, ctx) => {...})` → `addSystem('render', [RenderCtx], (ctx) => {...})`.
