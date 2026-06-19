# ADR-0088: Reflection type names default to `ctor.name`

- **Status:** Accepted
- **Date:** 2026-06-19

## Context

ADR-0060 and ADR-0061 established reflection and required every registered type to
carry a **hand-written stable `name`** (or a static `typeName`). The stated reason was
that `ctor.name` is unreliable under minification — a minified `Transform` becomes `q`,
which would corrupt the serialized type tag. So `TypeRegistry.register` threw when no
explicit name was given, and every `registerComponent`/`registerResource` call passed a
redundant string equal to the class name.

That rationale was tested empirically and is narrower than assumed. The only build step
that mangles `ctor.name` is **identifier** minification; whitespace and syntax
minification leave names intact. Bun's `--keep-names` flag (which would preserve names
through identifier minification) is currently a no-op (oven-sh/bun#25332, reproduced on
Bun 1.3.1), but esbuild's `--keep-names` works, and the engine's own packages ship via
`tsc` (unminified) so their `ctor.name` is already stable. The studio and the user-code
build path are under our control, so we can guarantee `ctor.name` stability by build
configuration rather than by forcing a redundant string at every call site.

This matters now because the Standalone Studio initiative loads user-authored components,
and requiring a hand-written name for every user component is friction with no payoff
when the build is configured correctly.

## Decision

- **The reflection type name defaults to `ctor.name`.** `RegisterOptions.name` becomes
  optional across `registerType` / `registerComponent` / `registerResource`. Resolution
  order is: explicit `name` → static `typeName` → `ctor.name`. Registration throws only
  for a truly anonymous class (empty `ctor.name`) with no explicit name.
- **An explicit `name` remains supported** and is the right choice for **namespacing**
  (`"mygame/Player"`) and **rename-safety** (keeping the serialized tag fixed across a
  class rename). It is no longer mandatory.
- **`ctor.name` stability is a build-configuration guarantee.** Any build that produces
  registrable types keeps identifier minification off. The v0 recipe is
  `--minify-whitespace --minify-syntax` (Bun), which preserves names and still strips
  whitespace/shortens syntax. Engine packages already ship name-stable via `tsc`. When
  Bun#25332 is fixed, `--minify-identifiers --keep-names` can be re-enabled for the extra
  size reduction; esbuild's working `keepNames` is the fallback.
- This **refines the name-resolution requirement** of ADR-0060/0061. The rest of those
  ADRs (the schema vocabulary, the registry, the serializer, per-plugin registration)
  stands unchanged; their bodies are not edited.

## Consequences

- New components — engine or user — register with `registerComponent(Ctor, schema)`. Less
  boilerplate, and the serialized tag matches the class name, closer to Bevy's type-path
  model. Existing explicit-name registrations keep working unchanged.
- The on-disk serialized type tag is now coupled to the class identifier by default:
  renaming a class changes its tag and breaks older saved data unless an explicit `name`
  pins it. Authors who care about rename-safety opt into an explicit name; this is the
  accepted trade for the ergonomic default.
- Every component-producing build must keep identifier minification off. This is encoded
  in the build scripts; a build that turns on `--minify-identifiers` without a working
  `--keep-names` would silently mangle tags. Tracked against Bun#25332.
- The studio bundle grows modestly (identifiers no longer minified). Negligible for a
  locally loaded desktop app.

## Implementation

- `packages/reflect/src/type-registry.ts` — `resolveName` (explicit → `typeName` →
  `ctor.name`), `RegisterOptions.name` optional
- `packages/engine/src/index.ts` — `App.registerComponent` / `registerType` /
  `registerResource` (delegate; `opts` already optional)
- `apps/studio/package.json` — `build` uses `--minify-whitespace --minify-syntax`
- `CLAUDE.md` §13 — name-resolution rule updated to point here
