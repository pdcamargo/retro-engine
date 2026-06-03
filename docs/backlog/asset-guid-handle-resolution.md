# Automatic GUID→handle resolution for scenes

- **Created:** 2026-06-03

## Context

`spawnScene` / `deserializeScene` currently require a caller-injected `resolveHandle`: a serialized scene stores asset references by `AssetGuid`, but nothing maps a GUID back to a live `Handle<T>` automatically. The persistent project tier that closes this is designed and deferred in **ADR-0055** and tracked as `asset-system.md` phases 4–6 (`.retro-project` layout, GUID `.meta` sidecars, manifest, `GUID→index` resolution on load, disk / bundle sources, promotion).

This item is the **scene-blocking slice** of that tier: the resolution path that lets a loaded scene's mesh / material / texture references resolve through the `AssetServer` with no injected resolver. The full project format + studio integration stay in `asset-system.md`.

## Why deferred

It is a multi-phase initiative (project format → reference resolution → sources), sealed as deferred in ADR-0055; front-loading it before scenes prove the requirements is speculative. The scene-as-asset slice can ship first with caller-injected resolution (mirroring how `spawnScene` shipped), then graduate to automatic resolution once the scene path shows exactly what GUID storage + lookup it needs.

## Acceptance

- A `Handle<T>` carrying a GUID resolves to a live store handle through the `AssetServer` without a caller-injected resolver.
- A scene referencing a mesh + material by GUID loads and renders with no `resolveHandle` passed to `spawnScene`.
- The full project format, disk / bundle sources, and studio integration remain tracked in `asset-system.md` phases 4–6 (out of scope here).
