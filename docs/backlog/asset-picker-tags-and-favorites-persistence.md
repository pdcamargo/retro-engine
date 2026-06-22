# Asset picker — asset tags + favorites/recents persistence

Two preview/metadata gaps left after ADR-0110:

- **Tags.** The design's preview pane shows asset tags (e.g. `environment`, `tileable`). The asset manifest (`AssetManifestEntry`: guid / location / kind) has no tag data, so the picker omits the tag row. Adding tags means extending the `.meta` sidecar + manifest to carry a tag list, surfacing it on `BrowserAsset`, and rendering + searching by it.
- **Favorites / recents persistence.** The picker's favorites and recents are session-local `Set`/array on `AssetPickerState`. Persist them per-project (mirror the Entity Composer's `persistPrefs` hook) so they survive a studio restart.

Image **dimensions** in the preview already work (read from the thumbnail decode via `ThumbnailService.dimensionsOf`); mesh/material show their kind string.
