---
'@retro-engine/engine': minor
---

feat(engine): scene files are YAML with the `.rescene` extension (ADR-0089)

Scenes now serialize/parse as UTF-8 YAML and load under the `.rescene` extension (was
`.scene` JSON). The `SceneData` envelope is unchanged — only the text codec and the
importer's extension key swap, so the payload and validation are identical. JSON is a YAML
subset, so existing JSON scene fixtures parse unchanged.

First increment of the on-disk format migration (ADR-0089, superseding ADR-0070): the TOML
`project.retroengine` descriptor, the `.meta`-sourced generated manifest, and the
`.reprefab` prefab kind follow in subsequent changes.
