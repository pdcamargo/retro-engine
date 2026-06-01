# @retro-engine/assets

Asset identity and storage primitives for Retro Engine: the `Handle<T>` value object, the `AssetIndex` / `AssetGuid` / `AssetId<T>` identity model, the generic `Assets<T>` store, and the importer / serializer / source registry **types**.

```sh
bun add @retro-engine/assets
```

See [ADR-0055](../../docs/adr/ADR-0055-asset-system.md). This package is a leaf — no other internal deps. The engine owns the wiring (`AssetServer`, `AssetPlugin`, load-drain) and consumes these primitives; the dependency runs `engine → assets` only.
