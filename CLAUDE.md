# Retro Engine — Operating Rules

A TypeScript game engine inspired by Bevy (composition-heavy ECS, WebGPU renderer from scratch) plus a Tauri + Bun + ImGui desktop studio. The engine targets the browser and desktop; the studio is a desktop app that hosts the engine for tooling.

These rules govern how this repo is worked on, including by any AI agent.

---

## 1. Commits

- Never append `Co-Authored-By: Claude`, `Generated with Claude Code`, or any similar trailer to commits.
- Never amend an existing commit unless the user explicitly asks. Create a new commit instead.
- Never use `--no-verify` or skip hooks unless explicitly requested.
- Use [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `chore:`, `refactor:`, `docs:`, `test:`, `build:`, `ci:`. Optional scope: `feat(ecs): ...`, `fix(renderer-webgpu): ...`.
- **Lint, typecheck, test, and build must always be green on `main`.** PRs that break any of those do not merge.

## 2. Research before deciding

For any non-trivial decision, unfamiliar API, or pattern check, use **WebSearch** or **WebFetch**. Do not guess WebGPU, WGSL, Tauri, Bun, Turborepo, oxlint, Changesets, jsimgui, or Bevy concepts from memory. If you reach for something and the cost of being wrong is non-zero, verify first.

## 3. Decisions, deferred work, bugs, roadmap

Four folders under `docs/`, one item per file. None of them ship with any package.

| Folder | Purpose | Naming | Lifecycle |
|---|---|---|---|
| `docs/adr/` | Architecture / non-trivial decisions | `ADR-NNNN-kebab-slug.md` (4-digit, zero-padded, monotonically increasing) | **Permanent.** See ADR immutability below. |
| `docs/backlog/` | Work deliberately deferred | `<kebab-slug>.md` | Deleted only after the user **explicitly confirms** the work is done. |
| `docs/bugs/` | Known bugs not yet fixed | `<kebab-slug>.md` | Deleted only after the user **explicitly confirms** the bug is fixed. |
| `docs/roadmap/` | Multi-step initiatives spanning multiple backlog items or milestones | `<kebab-slug>.md` | Living document. Edits allowed — it's a plan, not a record. Items move to `backlog/` when promoted; the roadmap file itself is deleted when the initiative is done. |

### ADR immutability

A sealed ADR is never rewritten. The **only** edit allowed on an existing ADR is flipping its `Status:` field to `Superseded by ADR-NNNN` and (optionally) adding a one-line pointer. The body, the decision, and the rationale stay frozen as historical record.

To change a decision: create a new ADR, set `Supersedes: ADR-NNNN`, and update the old ADR's status. Never edit the superseded ADR's content.

### "Done" / "fixed" requires explicit user confirmation

A backlog item is not done because the AI says so. A bug is not fixed because tests pass, the build is green, or "looks good to me". Wait for the user to say it explicitly, then delete the file.

## 4. Code comments in shipped packages

Anything under `packages/*/src/` ships to consumers of the engine.

- Public types, functions, classes, and constants get TSDoc comments (`/** ... */`) unless the identifier is self-explanatory (e.g. `Vec3`, `width`, `isReady`).
- Comments must read sensibly to a consumer who has never seen this repo, has never seen `docs/`, and will see only what's in the package.
- **Never** reference `ADR-NNNN`, backlog files, bug files, or any path inside `docs/` from a shipped source file. Not in summaries, not in `// remarks`, not anywhere.
- Internal task tracker IDs, sprint references, and one-off context belong in commit messages and PR descriptions, not in code.
- Default to no comment. Only add one when the **why** is non-obvious — a subtle constraint, an unintuitive invariant, a deliberate trade-off, a workaround for a specific bug.
- Anything under `apps/` is consumer-facing only via release artifacts; comments there can reference internal context freely (it's not a library).

### Linking code back to ADRs

Linkage is one-directional, **from the ADR side**. Each ADR has an `## Implementation` section listing the files and key public symbols it governs. To find which ADR rules a piece of code, grep `docs/adr/` for the symbol or path.

No reverse-map file. No in-code markers. If we ever find we genuinely need a reverse index, that itself becomes a new ADR.

## 5. Architecture rules

Non-negotiable. They flow from [ADR-0001](docs/adr/ADR-0001-architecture-foundations.md).

### 5.1 Composition vs inheritance — rule of thumb

- **Composition is the default.** Use it when A *has* behavior/data/capabilities provided by B.
- **Inheritance is a tool, not a sin.** Use it when A *is a specialized version of* B and the parent's invariants must be preserved across all subclasses.
- When in doubt, compose.

### 5.2 Where each fits in this codebase

- **`packages/ecs`, `packages/engine` (runtime/systems):** composition-only. Entities are IDs; behavior is components + systems. No base `Entity` / `GameObject` hierarchy. Plugins extend the App by registering systems and resources, not by subclassing.
- **`packages/renderer-core` (backend HAL):** interfaces / abstract contracts. WebGPU and (future) WebGL2 implementations are concrete classes/factories that conform. No shared abstract base — each backend stands on its own under the contract.
- **`packages/assets` (when added):** strategy + registry pattern. Each asset type registers loader / serializer / importer functions. No `BaseImporter` to extend.
- **`apps/studio`:** plugin-driven composition. No giant `EditorWindow` base class. Custom windows/dialogs register against an `EditorSDK` surface (lives in `packages/editor-sdk` when added). The `editor` namespace is reserved for SDK / runtime / tooling packages that the studio and future editor-* consumers build on.

### 5.3 Module boundaries

- Cross-package imports go through each package's public `src/index.ts` only. Deep imports into another package's internals are forbidden.
- `engine` depends on `ecs`, `math`, `renderer-core` — **never** on `renderer-webgpu`/`renderer-webgl2` directly. Backends are passed in at App startup via dependency injection.
- `studio` depends on `engine` + the chosen backend package(s), and (when added) on `editor-sdk`. `engine` and `editor-sdk` never depend on `studio`.
- `math` is a leaf — no other internal deps.
- `renderer-core` is a leaf — pure types/interfaces.

### 5.4 Day-1 capability flags

`renderer-core` exposes a `RendererCapabilities` struct (compute shaders, timestamp queries, indirect draw, storage textures, etc.). Engine code that needs an optional capability checks the flag and falls back. This exists from day 1 so WebGL2-incompatible features cannot sneak in unflagged.

### 5.5 Within-package file layout

`packages/*/src/index.ts` is the package's **public re-export entry point**, not its implementation. Implementations live in concern-named sibling files (`world.ts`, `query.ts`, `archetype.ts`, `time.ts`, `system-param.ts`, `log.ts`, etc.). One file = one logical concern: public types, storage primitives, read-only views, write APIs, lifecycle helpers, markers.

**Default to splitting.** Do not pile everything into one big `index.ts` "because it's easier." When in doubt:

- New concern that forces a reader to scroll through unrelated code to follow it? → New file.
- File past ~300 LOC with multiple distinct classes / closures / factories? → Look for the natural seam and split.
- Internal class (not re-exported from `index.ts`) doesn't escape this rule — it still lives in its concern-named file.

Cycles between sibling files are fine when one direction is `import type` only (a runtime `import` paired with a `import type` back-reference does not create a runtime cycle). Use that pattern when a class and its read-only view need to know about each other.

The existing layout to mirror:
- `packages/engine/src/{index.ts, system-param.ts, log.ts, time.ts}` — entry + each concern in its own file.
- `packages/ecs/src/{index.ts, types.ts, archetype.ts, query.ts, world.ts}` — same pattern.

## 6. Versioning and publishing

- **Semver.** Major = breaking, minor = additive, patch = bugfix.
- **Prereleases via Changesets pre-mode.** `bunx changeset pre enter rc` → versions become `0.5.0-rc.0`, `-rc.1`, etc. Same flow for `beta` and `alpha`. `bunx changeset pre exit` returns to stable.
- **Every PR touching `packages/*/src/**` needs a changeset.** During pre-0.1.0 scaffold phase, the gate is warning-only; it becomes a hard fail after the first published version.
- **Dist tags:** `latest` for stable, `next` for in-progress mainline, `rc`/`beta`/`alpha` for prerelease lines.
- **`apps/studio` is not published to npm.** Changesets ignores it. Studio versions ship as GitHub Releases via `tauri-apps/tauri-action`, triggered by a tag matching `studio-v*` (e.g. `studio-v0.3.0-beta.1`).
- **Registry:** [GitHub Packages](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-npm-registry), scoped to `@retro-engine`. Per-developer auth via `.npmrc` reading `${GITHUB_TOKEN}` from env. CI auth via the workflow's `GITHUB_TOKEN`.

## 7. Folder layout

```
.
├── CLAUDE.md
├── README.md
├── package.json                 # root, bun workspaces
├── turbo.json
├── tsconfig.base.json
├── oxlint.json
├── lefthook.yml
├── .changeset/
├── .github/workflows/           # ci.yml, release.yml, studio-release.yml
├── docs/
│   ├── adr/                     # ADR-NNNN-*.md, README, _template.md  (permanent)
│   ├── backlog/                 # deferred work, one file each         (deleted on done)
│   ├── bugs/                    # known bugs, one file each            (deleted on fixed)
│   └── roadmap/                 # multi-step initiatives, one file each (living)
├── packages/                    # publishable: @retro-engine/*
│   ├── ecs/
│   ├── math/
│   ├── renderer-core/
│   ├── renderer-webgpu/
│   ├── renderer-webgl2/
│   └── engine/
└── apps/                        # not publishable; private: true
    └── studio/                  # Tauri 2.x + Bun + jsimgui + engine
```

## 8. Where things go (decision tree)

- Made an architectural / non-trivial decision? → new file in `docs/adr/`.
- Decided to do something later? → new file in `docs/backlog/`.
- Found something broken that isn't being fixed right now? → new file in `docs/bugs/`.
- Starting a multi-step initiative that will span several backlog items or milestones? → new file in `docs/roadmap/`.
- Writing code that ends up in a published package? → it goes under `packages/<name>/src/`, follows §4 and §5.
- Editor / studio / dev-only tooling? → `apps/` or repo root, never inside a `packages/*/src/`.

## 9. Tauri tooling

The studio is a Tauri 2.x app. Some commands (`tauri build`, `tauri dev`) launch native processes and aren't easily undone.

- **Don't auto-rebuild the native shell** unless asked. Frontend-only changes don't require Tauri rebuild.
- **Confirm before destructive Tauri actions** — modifying `src-tauri/tauri.conf.json`'s `identifier` (changes app data location), changing `productName`, regenerating `Cargo.lock`.
- **Never assume Rust toolchain is willing** — running `cargo`/`rustc` can be slow on first build. If a `tauri dev` doesn't return in a reasonable time, surface that to the user rather than silently waiting.

## 10. Engine-specific guidance

- **WebGPU first, WebGL2 reachable.** No code outside `packages/renderer-webgpu/` may use the `GPU*` types directly. Always go through `renderer-core` interfaces.
- **Optional capabilities are flagged.** If a feature requires compute shaders, storage textures, or anything else WebGL2 can't do, gate it on `RendererCapabilities.<flag>` from day 1.
- **The ECS is the inversion point.** All gameplay code is data on components + functions over queries. No `Update()` method on a base class. Frame logic lives in systems.
- **Plugins are how features extend the App.** A plugin is a function that registers systems, resources, and component types into an `App`. Mirrors Bevy. No `AbstractPlugin` class.

## 11. Benchmarks

Performance regressions don't show up in `bun run test` — they show up later as visible jank. Catch them at the point of change, not three commits later. [ADR-0017](docs/adr/ADR-0017-benchmarking-infrastructure.md) is authoritative for methodology (mitata, per-package `bench/` folders, normalized JSON baselines, 1.5× regression threshold, `bench:check` semantics).

- **Aim to add a bench when shipping a feature on a hot path.** A "hot path" is anything in the per-frame chain (render dispatch, query iteration, schedule body, system param resolution, transform / visibility propagation, command flush, change-detection scan) or any algorithm whose cost grows with content (graph sort, topology, batching). Trivial value classes, one-shot setup code, and pure data transforms outside the frame loop don't need one. When in doubt, add the bench — a tiny file under `packages/<pkg>/bench/<concern>.bench.ts` is cheaper than chasing a regression after the fact.
- **`bun run bench` is part of the gate chain.** Same status as lint / typecheck / test / build: it must pass in lefthook pre-push and CI. The gate runs benches end-to-end (catches compile-time + runtime drift in bench files); it does **not** compare against committed baselines, because runner variance makes a single-threshold CI gate either flaky or so wide it's useless. New bench files don't break the gate; they just join the suite.
- **`bun run bench:check` stays local, pre-PR.** ADR-0017 §5 explains why CI doesn't compare. Run it on your machine before opening a PR that touches a hot path, after running `bun run bench:update` once to seed your laptop-local numbers.
- **Update baselines deliberately.** `bun run bench:update` overwrites every `bench/baseline.json` with the current machine's numbers. Commit the diff alongside the perf-relevant change so the PR reviewer sees the new numbers — same shape as a test snapshot update.
- **Bench files follow the same one-concern-per-file rule as `src/`** (CLAUDE.md §5.5). Bench helpers and stub renderers live in `packages/<pkg>/bench/helpers.ts`; bench files reference their owning ADR in a module-doc header (ADR references inside `packages/*/src/**` are still forbidden by §4 — bench files are excluded from the shipped build).

## 12. Scope decisions stand on evidence, not the name

"Retro" is the implementation aesthetic, not a capability ceiling. The only thing inherently constrained here is taste, never the engine's reach.

- **Never justify a scope cut, a capped limit, a skipped capability, or a "simpler" path with genre or name reasoning** — "retro engines don't need X", "games like this rarely do Y", "it's a retro engine so Z is overkill". These are not arguments; they are assumptions dressed as ones.
- Scope decisions rest on **real technical trade-offs, measured cost, WebGL2-reachability, or explicit project direction** (roadmap / backlog / ADR). If the honest reason to defer something is "it's bigger than this slice" or "it commits us to an SSBO/compute dependency", say that — don't reach for the genre.
- A capability the roadmap plans (e.g. clustered shading) is planned because it's correct, not because the engine is "fancy enough" for it. Defer it for sequencing/cost reasons and track it (§8), never because the name implies it's unnecessary.

## 13. Engine components declare their serialization

Reflection is how the engine round-trips world state into scenes and back ([ADR-0060](docs/adr/ADR-0060-reflection-and-serialization.md), [ADR-0061](docs/adr/ADR-0061-reflection-on-engine-components.md)). For that to hold, every component is a deliberate decision — serialized or not — never an accident.

- **Every component type defined in `packages/*/src/**` (engine or any internal package) has a reflection schema**, registered by its owning plugin (`app.registerComponent(Ctor, schema, { name })` in `build()`), **unless it is deliberately not serialized.**
- **"Deliberately not serialized" is a real, named category**, not an oversight: derived/computed state recomputed by a system (`GlobalTransform`, the inherited/view visibility booleans), reciprocal relationship targets rebuilt from their edge (`Children`), transient caches, and runtime-only handles with no persistent identity. A derived component is simply not registered; a single non-persisted field on an otherwise-serialized component uses `.skip()`.
- **The default is persistence.** If a component (or field) is authored state a consumer would expect to survive a saved scene, it has a schema. Adding a new authored component without one is a gap to fix, not a default to accept.
- Registration is **per owning plugin** (the `AppTypeRegistry` resource accumulates them), never one central dump. A stable `name` is mandatory — never the class name (minification-unsafe).

The registry is populated slice by slice as systems are touched; components not yet decided are a tracked gap, not a silent one — the end state is every component classified.
