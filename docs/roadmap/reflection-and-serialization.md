# Reflection and Serialization

- **Created:** 2026-05-21
- **Status:** Future direction (sketch — foundation for scenes/prefabs)

## Goal

A TypeScript analog to Bevy's reflection + serialization stack. Components, resources, and (eventually) systems describe their schema once — field names, types, defaults — and the engine uses that metadata to drive scene serialization, prefab definitions, save/load, editor inspectors, and (when needed) name-based change detection.

The Bevy equivalent: `#[derive(Reflect)]` + `TypeRegistry` + `DynamicScene`. Our TS equivalent: decorator-driven (or registration-call-driven — open question) metadata that lands in a global `TypeRegistry`, with JSON or binary scene formats reading from that registry to round-trip world state.

We're done when a component class can be defined once with type metadata, registered, and round-tripped through the scene format without hand-rolling a serializer per type.

## Phases

1. **Type registration mechanism** — decide the shape: TC39 decorators (`@reflect class Health { @field health = 100 }`); explicit registration call (`registerComponent(Health, { fields: { health: 'number' } })`); class-static metadata; symbol-keyed property descriptors. **Open** — see below.
2. **TypeRegistry** — global registry of registered types keyed by stable name (not class identity — survives minification and dynamic imports). Maps registered name → constructor + field schema + default factory.
3. **Field introspection** — given a registered component, enumerate its fields, read their values, write new values. Foundation for editor inspectors and scene serialization.
4. **Serialization** — convert a world (or a subset — a scene's entities) to JSON via the type registry. Round-trip: load → spawn entities → register observers → reach the same world state.
5. **Annotations** — `@SkipSerialize`, `@DefaultIfMissing`, `@Migrate(version)`, `@Reference(type)` for handle resolution. Lets specific fields opt out, version-migrate, or reference other registered entities/assets.
6. **Change detection by name** — when reflection metadata is available, a generic "did this field change since last frame?" query becomes possible. Niche; relevant for editor live-update.
7. **Reflection-driven editor inspector** — the studio reads the type registry to draw inspector widgets per field type. Far-future; on the studio side.

## Open questions

- **Decorators vs registration calls.** TC39 decorators (stage 3 at time of writing, supported in TS 5+) read clean but tie us to a feature still firming up in the ecosystem. Explicit registration calls are uglier but boring (no spec risk). Default lean: registration calls first, decorators as an optional sugar layer on top once we know the spec landed safely.
- **Stable type names.** Class names are unreliable (minification, dynamic-import name collisions). Recommend: require an explicit `static __retroTypeName = 'Health'` (or constructor arg) on registered types. Bevy uses fully-qualified Rust paths; we don't have that — explicit names are the right call.
- **Field type vocabulary.** Primitives (`'number'`, `'string'`, `'boolean'`), composites (`{ kind: 'array', of: ... }`, `{ kind: 'tuple', of: [...] }`), entity refs (`{ kind: 'entity' }`), asset handles (`{ kind: 'handle', of: 'Texture' }`). Minimum viable set is small; design for extension.
- **Versioning + migration.** When a component's field set changes, old scene files break. `@Migrate(fromVersion, migrator)` annotations let new code load old files. Worth designing in from day 1.
- **Reflection cost at runtime.** A registered type costs memory (the schema metadata) but no per-instance overhead unless you actually serialize. Acceptable.
- **Should resources be reflectable too?** Probably yes — scene files can include state-scoped resource definitions.
- **Generic / parameterized types.** A `Handle<Texture>` is parameterized; reflection needs to express that. Defer until concrete cases demand it.

## Links

- Foundation: `docs/roadmap/engine-foundations.md` (reflection isn't a phase of M2 but its design interacts with Required Components — component classes already declare a `requires` static; reflection adds `fields` similarly)
- Consumer: `docs/roadmap/scenes-and-prefabs.md` — primary consumer; scenes can't be serialized without reflection.
- Consumer: `docs/roadmap/asset-system.md` — handle resolution during scene load.
- Consumer: `docs/roadmap/editor-sdk.md` — the studio inspector reads from the registry.
- Consumer: `docs/roadmap/change-detection.md` (potentially — name-based change-detection is reflection-enabled).
- External:
  - Bevy `Reflect` trait + `TypeRegistry` ([docs.rs/bevy/reflect](https://docs.rs/bevy/latest/bevy/reflect/index.html))
  - Auto-registration of `#[derive(Reflect)]` types ([Bevy 0.17 release notes](https://bevy.org/news/bevy-0-17/))
  - TC39 decorators proposal ([tc39/proposal-decorators](https://github.com/tc39/proposal-decorators))
