# @retro-engine/reflect

Runtime type reflection for Retro Engine.

A component or value type describes its schema once — field names, types, defaults — and the engine uses that metadata to round-trip world state through a JSON scene format, drive a future inspector, and resolve cross-references on load.

- **`TypeRegistry`** — registered types keyed by an explicit **stable name** (not the class name, which dies under minification).
- **`t`** — a typed field-type vocabulary (`t.number`, `t.vec3`, `t.color`, `t.array`, `t.struct`, `t.entity`, `t.handle`, `t.type`, …) whose static type and runtime descriptor stay in sync: a missing, renamed, or mistyped field in a schema is a compile error.
- **codec** — `encodeValue` / `decodeValue` and the component-level `encodeComponent` / `decodeComponent`, with an injected context so entity-reference remapping and asset-handle resolution stay where the `World` and `Assets` stores live.

This package is reflection only. The world/scene serializer that walks a live `World` lives in `@retro-engine/engine`.
