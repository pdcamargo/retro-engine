---
'@retro-engine/engine': minor
---

feat(engine): per-asset texture `.meta` overrides

Phase 2 of texture import settings (ADR-0166). A `<name>.meta` sidecar (UTF-8 JSON
of `TextureImportSettings`) next to a texture overrides the importer's project
default for that one texture:

```jsonc
// wood.png.meta
{ "filter": "nearest", "wrap": "repeat", "colorSpace": "linear" }
```

The image importer reads its own sibling `.meta` through the load context and
merges the recognized fields over the default; a missing or malformed sidecar is
silently ignored. New `parseTextureMeta` (keeps only valid fields, throws only on
non-JSON) and `textureMetaSibling`. Implemented importer-local — no asset-server
or `LoadContext`-shape change. Baking `.meta` into the packed manifest for the
bundle path is a tracked follow-up.
