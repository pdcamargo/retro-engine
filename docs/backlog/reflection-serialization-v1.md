# Reflection & Serialization v1

- **Created:** 2026-06-02

## Context

The keystone slice that gives the engine `World ⇄ data`, the inverse of the glTF `data → World` instantiation that ADR-0057 shipped. Sealed by **ADR-0060**. Delivers the foundation that `scenes-and-prefabs.md`, the future studio inspector, and scene-load handle resolution depend on.

What landed:

- New package **`@retro-engine/reflect`** — `TypeRegistry` keyed by an explicit stable name; the typed `t` field-type vocabulary (primitives, `array`/`tuple`/`struct`/`enum`, `vec2`/`vec3`/`vec4`/`quat`/`mat4`, `color`, `entity`, `handle`, `type`) with static-type↔descriptor coherence; field introspection; and a JSON value codec with per-type `version` + `migrations` and an injected context for reference remapping/resolution.
- World/scene serializer in **`packages/engine/src/scene/`** — `serializeWorld` / `deserializeScene` (+ `SceneData`), with two-phase entity-reference remapping and asset-handle resolution by GUID through an injected resolver.

## Why deferred

Not deferred — implemented in this slice. This file is the **done gate**: it tracks the slice until the work is confirmed complete and is then deleted (per `docs/backlog/README.md`, only on explicit confirmation).

Deliberately out of this slice, to be promoted as their own items when a consumer needs them (all reserved in ADR-0060): decorators as registration sugar, change-detection-by-name, the studio inspector, resources-as-reflectable, scene composition, retrofitting engine components (`Transform`, `Name`, …) into the registry, an App/Commands hook-firing deserialize path, and an asset-server GUID→handle bridge.

## Acceptance

- `@retro-engine/reflect` registers a component once, keyed by a stable name that survives a class rename, and rejects registration with no resolvable name.
- The `t` vocabulary makes a missing, renamed, or mistyped field in a `Schema<T>` a compile error.
- A hand-authored component set round-trips `serializeWorld → JSON → deserializeScene` into a fresh world with identical state: math types (`Vec3`/`Quat`/`Mat4`) and `color` preserved, nested registered types reconstructed as their class, entity references remapped to freshly-spawned entities, asset handles preserved by GUID, `.skip()` / `.default()` / `.optional()` / `.nullable()` honored, and a `version` migration applied to older data.
- Lint, typecheck, test, build, and bench are green.
