# ADR-0007: Engine Logger

- **Status:** Accepted
- **Date:** 2026-05-22

## Context

M2 phase 2 introduces the engine's first diagnostic surface: a warning when `App.insertResource` replaces an existing resource. Phases 3-7 will add more (clock drift in `Time`, archetype anomalies, `Commands` flush overflows, transform-hierarchy cycles, plugin lifecycle warnings). Two questions need a single answer before that pattern accrues:

1. **Where does the dev-vs-prod gate live?** Open-coding `if (NODE_ENV !== 'production') console.warn(...)` at each call site spreads env-checking across the engine and forces every consumer (studio, tests, future Tauri panel) to monkey-patch `console.*` to intercept.
2. **How do diagnostics reach a different sink — a studio log panel, Tauri's tracing layer, telemetry?** With direct `console.*` calls, the answer is "grep and migrate every site." That's a cost we should not be paying after one warn site exists, let alone after fifteen.

Bevy solves this in Rust with the `tracing` crate plus build-time-stripped levels. TypeScript has no direct equivalent, and we don't need one — a small interface plus a default impl covers the cases we have and will have through M2.

## Decision

Engine diagnostics flow through a `Logger` value, not direct `console.*`. The `Logger` interface and its default impl ship in `packages/engine`. Phase 2 is the first consumer.

**Interface:**

```ts
interface Logger {
  error(msg: string): void;
  warn(msg: string): void;
  info(msg: string): void;
  debug(msg: string): void;
  /** Dev-only advisory. Emits in development, silent in production. */
  devWarn(msg: string): void;
  /** Labelled view sharing the same sink. Prefixes emissions with `[category]`. */
  child(category: string): Logger;
}
```

**Ownership.** `App` holds `logger: Logger` as a field, initialised from `AppOptions.logger ?? engineLogger` (the module-global default). Plugins and engine subsystems reach the logger through `app.logger` and capture a child view (`app.logger.child('renderer-webgpu')`) at plugin-build time, closing over the child in their systems. Each `App` has its own logger; multi-App scenarios — parallel tests, studio hosting more than one App — isolate cleanly.

**Severity vs dev-only are separate axes.** `error` / `warn` / `info` / `debug` are conventional severities and always emit (no level filtering in v1). `devWarn` is the **only** method gated on `typeof process !== 'undefined' && process.env.NODE_ENV !== 'production'`. "This message only matters during development" and "what severity is this" are independent — phase 2's double-insert is a `devWarn`, while a future "transform hierarchy has a cycle" stays a plain `warn` that prod users should see.

**Default impl.** `ConsoleLogger` forwards `error`/`warn`/`info`/`debug` to `console.error`/`console.warn`/`console.info`/`console.debug`. `devWarn` checks the env gate and routes to `console.warn`. `child(cat)` returns a new `ConsoleLogger` over the same root that prefixes each emission with `[cat]`; nested children compose prefixes (`[renderer-webgpu][shader]`). Defensive `typeof process` check is required because the engine ships to browsers that may not have a `process` global if a consumer skips bundling; bundlers (Vite/esbuild/Rollup) still dead-code-eliminate the warn path in production builds.

**Sink replacement.** A consumer (studio, tests, future telemetry) constructs its own `Logger` implementation and passes it via `AppOptions.logger`. All engine and plugin code flows through that sink with zero call-site changes. Studio's Tauri bridge is the canonical motivating case.

**Leaf packages do not depend on the logger.** `renderer-core` / `renderer-webgpu` / `renderer-webgl2` / `ecs` / `math` are leaves under ADR-0001. The flip-side of "no access to the logger" is a non-negotiable error-discipline rule:

- **Leaves must throw, not swallow.** Any failure mode, unexpected condition, or invariant breach raises an `Error` with a message specific and self-contained enough that the engine can log it verbatim. Returning `undefined` / `null` / `false` / empty results to signal an error is forbidden — those return values are reserved for documented "absent" cases (e.g., `getResource` returning `undefined` for a key that was never inserted is absence, not failure).
- **Error messages are the diagnostic surface.** A leaf has no logger; its only channel for telling someone what went wrong is `Error.message`. Messages include enough context (package-name prefix like `renderer-webgpu:`, the operation, the offending state) that a developer reading logger output can act on it without source-symbol lookup. Bad: `throw new Error('invalid')`. Good: `throw new Error('renderer-webgpu: createRenderPipeline failed — fragment entry point "fs_main" missing from shader module "triangle.wgsl"')`.
- **Engine catches at the boundary and logs.** Code in `packages/engine` that calls into a leaf, where a recoverable failure mode exists, wraps the call, catches, and routes through the App's logger at the appropriate severity. Unrecoverable failures propagate.
- **No `console.*` calls from leaf packages.** Enforced by review in v1; promote to an oxlint rule if violations accrue.

**Extraction trigger for `packages/log`.** If a leaf package ever legitimately needs to log directly (not just throw), that is the signal to factor the `Logger` interface into a new leaf workspace `packages/log` under a follow-up ADR. Until then, `Logger` lives in `packages/engine`.

**Out of scope in v1:** structured fields (the messages are plain strings), per-category level filtering, transport plugins, multiple sinks per logger, async or buffered logging, log file rotation. Each is added only when a concrete second use lands.

### Rejected alternatives

- **Open-coded `if (NODE_ENV !== 'production') console.warn(...)` at every call site.** Spreads env-checking, prevents sink swap without monkey-patching, and pushes consumers to globally rebind `console.*`.
- **Levels-only logger with a configurable threshold (no `devWarn`).** Conflates severity with "matters during dev only." Either prod-warn becomes noisy or dev-only advisories get demoted to debug and lost in the noise. Two axes deserve two methods.
- **Module-global logger only (no per-App field).** Multi-App tests / studio scenarios can't isolate without resetting the global between Apps. Per-App scope costs one field on `App` and one optional `AppOptions` key; the win is structural.
- **Per-App logger only (no module-global default).** Forces every utility function and every plugin to take a Logger argument. The module-global default is a small concession that covers the rare logging-without-an-App case and keeps the common path frictionless.
- **Tracing-style structured events in v1.** Premature: no consumer needs them. The single-string-message shape is forward-compatible — a future `Logger.event(name, fields)` method can land additively.

## Consequences

**Easier:**
- New diagnostic surfaces are one method call (`this.logger.devWarn('…')` or `app.logger.warn('…')`) with no env-checking ceremony.
- Studio can route engine diagnostics into a Tauri-side log panel by passing one custom `Logger` at App construction — zero code changes in the engine or in plugins.
- Tests capture and assert against `devWarn`/`warn` calls by passing a spy logger; no more mocking `console.warn`.
- Subsystem categorisation (`app.logger.child('renderer-webgpu')`) is a one-line capture at plugin-build time. Tauri sinks can route by category.
- The leaf-throws-not-swallows rule makes error sites debuggable from the message alone, which is the only surface a leaf has.

**Harder:**
- Engine and plugin code must always have an `App` in reach to log (or capture a child logger at plugin-build time). Pure utility code outside an App's reach uses the module-global `engineLogger`, which is a marginally less clean call site.
- Leaf packages forfeit a logger and must take error-message hygiene seriously. A bad `Error.message` from a leaf is harder to fix later than a logger call would have been to add at the same site.
- The `Logger` interface is one more surface to keep stable. Adding methods (e.g., `event` for structured logging) is additive and safe; renaming or removing methods is a breaking change.
- A consumer that ships unbundled to a browser without a build-time `process.env.NODE_ENV` substitution will see `devWarn` always emit (because `typeof process !== 'undefined'` is the guard, not the value). Documented; bundlers handle it.

## Implementation

- `packages/engine/src/log.ts` — `Logger`, `ConsoleLogger`, `engineLogger`, `createConsoleLogger`
- `packages/engine/src/index.ts` — `AppOptions.logger?`, `App.logger`, re-exports of `Logger` / `engineLogger` / `createConsoleLogger`
- `packages/engine/src/index.test.ts` — `ConsoleLogger` prefix correctness, nested-child composition, `devWarn` env gate, `AppOptions.logger` override wiring
