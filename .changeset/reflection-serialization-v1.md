---
'@retro-engine/reflect': minor
'@retro-engine/engine': minor
---

feat(reflect): reflection + serialization v1 — TypeRegistry, typed field-type vocabulary, world↔scene JSON round-trip

Per ADR-0060. Adds the new `@retro-engine/reflect` package and a world/scene serializer in `@retro-engine/engine` — the keystone for scenes/prefabs, save/load, and a future inspector.

`@retro-engine/reflect`:

- A `TypeRegistry` keyed by an explicit **stable name** (a registration option or a static `typeName`, never the class name — class names die under minification).
- The typed `t` field-type vocabulary — `number` / `string` / `boolean`, `array` / `tuple` / `struct` / `enum`, `vec2` / `vec3` / `vec4` / `quat` / `mat4`, `color`, `entity`, `handle(assetType)`, and `type(Ctor)` for nested registered values. A schema's static type and runtime descriptor stay in sync: a missing, renamed, or mistyped field is a compile error. Field-type modifiers `.optional()` / `.nullable()` / `.nullish()` / `.skip()` / `.default()` / `.meta()`.
- Field introspection (`RegisteredType.fields`, `readField` / `writeField`) and a JSON value codec (`encodeComponent` / `decodeComponent`) with per-type `version` + ordered `migrations`.

`@retro-engine/engine`:

- `serializeWorld` / `deserializeScene` (+ `SceneData`). Deserialize is two-phase — every entity is spawned empty first so entity-reference fields remap to freshly-spawned entities — and resolves asset handles by GUID through a caller-injected resolver.

Reflection registration is one-time and serialization is on-demand (not per-frame), so no benchmark is added. Decorators, change-detection-by-name, the studio inspector, resources-as-reflectable, scene composition, and engine-component retrofit are reserved (see ADR-0060).
