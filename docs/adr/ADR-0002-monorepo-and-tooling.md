# ADR-0002: Monorepo, Workspaces, and Tooling

- **Status:** Accepted
- **Date:** 2026-05-21

## Context

The project will produce multiple publishable packages (`ecs`, `math`, `renderer-core`, `renderer-webgpu`, `renderer-webgl2`, `engine`, eventually `assets`, `input`, `editor-sdk`, `audio`) and at least two apps (`studio`, eventually `playground`). They share TypeScript configuration, a lint/test/build pipeline, and need consistent versioning. The user wants a fast, modern toolchain: Bun as runtime/test runner, Turborepo for task orchestration, oxlint for linting.

## Decision

- **Package manager + runtime + test runner:** Bun (`>=1.3`). Workspaces declared at root via `"workspaces": ["packages/*", "apps/*"]`.
- **Task runner:** Turborepo 2.x. `turbo.json` defines `build`, `lint`, `test`, `typecheck`, `dev`. `build` and `test` and `typecheck` depend on upstream `^build`. `dev` is uncached and persistent.
- **TypeScript:** strict everywhere. ESM only. `moduleResolution: "Bundler"`. Single `tsconfig.base.json` at root that each package extends.
- **Linting:** [oxlint](https://oxc.rs/docs/guide/usage/linter/quickstart). Single `oxlint.json` at root. Per-package overrides allowed but discouraged.
- **Formatting:** rely on `.editorconfig` + oxlint until oxlint's formatter is stable. No Prettier.
- **Testing:** Bun's built-in test runner (`bun test`). Tests colocated as `*.test.ts` next to source. No Jest, no Vitest.
- **Git hooks:** [lefthook](https://github.com/evilmartians/lefthook). Pre-commit runs oxlint on staged files; pre-push runs full `turbo lint typecheck test`.
- **Versioning:** [Changesets](https://github.com/changesets/changesets). Restricted access (private packages). See [ADR-0004](ADR-0004-publishing-and-versioning.md).

## Consequences

**Easier:**
- One toolchain to learn and configure across packages.
- Fast feedback loops — oxlint is sub-second, Bun's test runner is fast and TS-native, Turborepo caches all task outputs.
- Local-dev gate (lefthook pre-push) runs the same commands CI runs.

**Harder:**
- Bun is younger than pnpm/npm; occasional ecosystem rough edges (we accept).
- oxlint is also young; some ESLint rules don't exist yet (we accept; switch to ESLint or augment if a missing rule becomes critical).
- TypeScript project references not used initially — keeps configs simpler at the cost of slightly slower full builds. Revisit if build time becomes painful.

## Implementation

- `package.json` (root) — workspaces declaration, dev dependencies, scripts
- `turbo.json` — task pipeline
- `tsconfig.base.json` — strict shared TS config
- `oxlint.json` — lint config
- `lefthook.yml` — git hook commands
- `bunfig.toml` _(none yet)_ — add when bun-specific config needed
