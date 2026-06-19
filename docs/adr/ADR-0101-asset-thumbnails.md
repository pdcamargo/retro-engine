# ADR-0101: Asset-browser thumbnails

- **Status:** Accepted
- **Date:** 2026-06-19

## Context

The studio's Assets panel rendered a mock list with procedural type placeholders. A real
standalone studio needs the project's actual assets in the browser, with visual previews —
so a texture reads as its image, not a generic icon. The open question was the cache shape:
regenerate previews in memory each session vs persist them.

## Decision

- **One preview master per asset, sampled at every zoom.** Each previewable asset renders to
  a single 256-px master texture; the browser draws that one texture at whatever tile size the
  zoom selects (list → lg). This is the scalable shape — one generation, many display sizes —
  so changing zoom costs nothing.
- **Generation is lazy, async, and off the frame path.** `ThumbnailService.get(guid, location)`
  returns the cached `ImTextureRef` or `undefined` (kicking generation on the first miss); the
  card shows its procedural placeholder until the master is ready. Generation never blocks a
  frame. Keyed by asset GUID, held in an in-memory map.
- **Image thumbnails first.** v1 generates previews for image assets — decode via the webview's
  `createImageBitmap` + `OffscreenCanvas` (aspect-preserved, centered), upload through the HAL
  (`createTexture` + `writeTexture`), register with ImGui. Meshes / scenes / prefabs keep their
  procedural previews for now.
- **The browser is driven by the file index.** `buildBrowserAssets(manifest)` turns the scanned
  `.meta` manifest into the browser's asset list (name, type, GUID, location), so it shows the
  project's real assets with no built App. Mapped onto `state.browser`, which the Assets panel
  reads.
- **The `assetCard` widget gains an optional `thumbnail` slot** and `Draw.image` paints a
  registered texture into a draw-list rectangle — the editor-sdk surface a generated preview
  needs, falling back to the procedural preview when absent.

### Deferred (the on-disk cache + rendered geometry previews)

The decided end state is a git-ignored `.re/thumbnails/<guid>.<hash8>.png` cache (content-hash
keyed) under an in-memory LRU, plus **rendered** previews for meshes / scenes / prefabs (an
offscreen GPU pass per asset). These land together because the disk cache's real payoff is
avoiding re-rendering the *expensive* geometry previews each session — image decode is cheap
enough that in-memory regeneration is fine for v1. Tracked in
`docs/backlog/asset-thumbnail-cache-and-geometry-previews.md`.

## Consequences

- The Assets panel shows a project's real assets with image thumbnails, verified on a live
  `tauri dev` shell (`leaves.png` decodes → uploads → draws). Meshes/scenes show their typed
  procedural previews.
- Thumbnail generation must run after the renderer's device is up (a boot-time pre-warm raced
  device init and was dropped); lazy panel-render generation is naturally past that point.
- The `assetCard` `thumbnail` slot + `Draw.image` are additive editor-sdk surface — existing
  callers are unaffected (the field is optional).

## Implementation

- `apps/studio/src/thumbnails/thumbnail-service.ts` — `ThumbnailService` (decode + upload + cache)
- `apps/studio/src/project/project-browser.ts` — `BrowserAsset`, `ProjectBrowser`, `buildBrowserAssets`
- `apps/studio/src/panels-dock.ts` — Assets panel renders `state.browser` with thumbnails
- `apps/studio/src/state.ts` — `StudioState.browser`
- `apps/studio/src/main.ts` — build the browser + service from the scanned manifest on project open
- `packages/editor-sdk/src/draw.ts` — `Draw.image`
- `packages/editor-sdk/src/components-asset.ts` — `AssetCardOptions.thumbnail` + preview path
