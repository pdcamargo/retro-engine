# ADR-0060: Reflection and Serialization (v1)

- **Status:** Accepted
- **Date:** 2026-06-02

## Context

glTF instantiation (ADR-0057) shipped the spawn half of prefabs — data becomes a live, named entity tree. The inverse is missing: turning a live `World` (or a curated subset) into portable data and back. Scenes/prefabs, a future studio inspector, save/load, and scene-load handle resolution all need that round-trip, driven by per-type schema metadata. This is the analog of Bevy's `Reflect` + `TypeRegistry` + `DynamicScene`. The asset system (ADR-0055, ADR-0056) is landed, so handles exist to reference.

Constraints that force the shape of the decision:

- TypeScript has no runtime type information, and class names die under minification — type identity for serialization must be an explicit stable name.
- The field-type vocabulary must keep a field's static type and its runtime descriptor in sync: a missing, renamed, or mistyped field in a schema should fail to compile, not at runtime.
- Cross-package boundaries are real: `Entity` lives in `ecs`, `Handle` in `assets`. A handle's `AssetIndex` / `AssetGuid` are `unique symbol` brands that cannot be structurally redeclared.

Research (verified, not assumed):

- TC39 decorators are Stage 3 (shipped in TS 5.0) and decorator metadata (`Symbol.metadata`) shipped in TS 5.2, but design-time *type* information is still not exposed to standard decorators (microsoft/TypeScript#57533). Even with decorators, field types must be declared explicitly — so a registration call is the correct foundation and decorators are pure sugar over the same explicit schema.
- Bevy's `DynamicScene::write_to_world` remaps entities through an id→`Entity` map, reserving/spawning first and then remapping entity-typed fields — structurally identical to this engine's glTF reserved-id approach.
- Zod / TypeBox confirm the coherence mechanism: a phantom `FieldType<T>` plus a mapped `Schema<T>` makes schema drift a compile error.

## Decision

- A new package **`@retro-engine/reflect`** owns reflection: a `TypeRegistry`, the `t` field-type vocabulary, field introspection, and a value codec. The world/scene serializer that walks a live `World` lives in **`packages/engine/src/scene/`** — the composition root where `World`, `Assets`, and the registry meet.
- **Stable name is mandatory.** A type is keyed by an explicit name passed at registration or a `static typeName`; registration throws if neither is present. The class name is never used.
- **Field-type vocabulary.** `t` covers primitives (`number` / `string` / `boolean`), composites (`array` / `tuple` / `struct` / `enum`), math types (`vec2` / `vec3` / `vec4` / `quat` / `mat4`, reconstructed as `Float32Array`), `color`, and references (`entity`, `handle(assetType)`, `type(Ctor)` for nested registered values). Coherence is enforced by `type Fields<T>` (data fields only) and `type Schema<T> = { [K in keyof Fields<T>]-?: FieldType<Fields<T>[K]> }`. Modifiers `.optional()` / `.nullable()` / `.nullish()` / `.skip()` / `.default()` / `.meta()` shift the static type and/or set descriptor flags. A distinct `kind` carries any difference that changes how a value serializes or its static type; `.meta()` carries purely presentational hints that do not.
- **v1 mechanism is the registration call** (`registerType` / `registerComponent`). Decorators are deferred: a future adapter can desugar a decorator to `registerComponent` after a `Symbol.metadata` spike; nothing in the registry assumes decorators exist.
- **Package coupling.** `reflect` type-depends on `@retro-engine/ecs` (`Entity`, `ComponentType`) and `@retro-engine/assets` (`Handle`) so `t.entity()` / `t.handle()` produce field types assignable to the real ones. These imports are type-only (no runtime coupling). A "pure leaf with locally redeclared brands" was rejected because `Handle`'s `unique symbol` brands cannot be structurally reproduced, so it could not deliver coherence. `wgpu-matrix` is a direct dependency for the vector/quaternion/matrix field types. The remap/resolve *logic* — which needs live `World` / `Assets` instances — stays in the engine serializer, not in `reflect`.
- **Codec context is injected.** Generic kinds encode/decode with no context; `entity` and `handle` delegate to an `EncodeEnv` / `DecodeEnv` supplied by the serializer.
- **Entity remapping is two-phase** and uses only public `World` API: spawn an empty entity per serialized entity (building a compact-id → `Entity` map), then decode and insert components with entity-typed fields remapped through the map. Serialized ids are compact `0..N`. A reference with no target in the scene decodes to a configurable null entity (default `0`, never a live id). v1 writes directly into a bare `World`; engine lifecycle hooks live in the command flush, not in `World`, and are not invoked on load.
- **Handles serialize by GUID.** A handle with no GUID (a runtime-only asset) has no persistent identity and is omitted. There is no global GUID→handle resolver, so deserialize requires a caller-injected `resolveHandle` when the scene contains handle fields.
- **Versioning is designed in.** A serialized value is `{ type, version, data }`; a registered type carries a `version` (default `1`) and ordered `migrations` (vN→vN+1) applied in sequence when older data is loaded.

## Consequences

- Unblocks scene/prefab serialization, save/load, and a future reflection-driven inspector that reads `RegisteredType.fields` and `FieldMeta`. A glTF scene can become a prefab source through the same instantiation model.
- Schema drift is caught at compile time, not as a runtime serialization bug — the highest-value property of the typed vocabulary.
- Accepted costs: registration is explicit (one call per type) until decorators land; `reflect` is not a pure leaf (type-only deps on `ecs` + `assets`) — a deliberate trade of purity for coherence; v1 deserialize bypasses component hooks, so hook-dependent setup does not run on load yet; handle resolution and the dangling-reference policy are caller-injected.
- Reserved, named but not built here: decorators; change-detection-by-name; the studio inspector; resources-as-reflectable; scene composition; retrofitting engine components (`Transform`, `Name`, …) into the registry; an App/Commands hook-firing deserialize path; an asset-server `loadByGuid` / manifest-index bridge to resolve handles automatically.
- No benchmark: registration is one-time and serialization is on-demand rather than per-frame, so no hot-path bench is warranted (CLAUDE.md §11).

## Implementation

- `packages/reflect/src/field-type.ts` — `FieldType`, `FieldKind`, `FieldMeta`, `t`
- `packages/reflect/src/schema.ts` — `Fields`, `Schema`
- `packages/reflect/src/type-registry.ts` — `TypeRegistry`, `registerType`, `registerComponent`, `defaultRegistry`, `RegisteredType`, `RegisterOptions`, `Migration`, `readField`, `writeField`
- `packages/reflect/src/codec.ts` — `encodeValue`, `decodeValue`, `encodeComponent`, `decodeComponent`, `EncodeEnv`, `DecodeEnv`, `SerializedValue`
- `packages/reflect/src/index.ts` — public surface
- `packages/engine/src/scene/scene-data.ts` — `SceneData`, `SerializedEntity`, `SerializedComponent`, `SCENE_FORMAT_VERSION`
- `packages/engine/src/scene/serialize.ts` — `serializeWorld`, `SerializeOptions`
- `packages/engine/src/scene/deserialize.ts` — `deserializeScene`, `DeserializeOptions`
- `packages/engine/src/index.ts` — re-exports of the scene serializer surface
