---
'@retro-engine/runtime-web': minor
'@retro-engine/build': minor
---

feat(runtime-web): runtime .rpak asset delivery — RpakAssetSource + bootWebGame wiring (web export asset phase B)

Exported games can now load their packed assets. `bootWebGame` fetches the
manifest, opens a `.rpak`-backed asset source, and binds it to the App's
`AssetServer` before the game's plugins run — so their loaders resolve GUIDs from
the archive over HTTP.

**`@retro-engine/runtime-web`:**

- `RpakAssetSource` — an `AssetSource` reading assets from a `.rpak` by GUID,
  resolving the server's location-based `read` through the project manifest
  (location → GUID). Opens the archive lazily (one header + TOC fetch), then
  streams each entry's byte range.
- `httpRangeFetch(url)` — a `RangeFetch` over HTTP `Range`, robust to servers
  that ignore the range and return the whole body (`200`) by slicing locally.
- `bootWebGame({ assets: { rpakUrl, manifestUrl } })` — wires the above (fetch
  manifest → `AssetPlugin({ source })` → `setManifest`); sets `window.__retroAssets`.

**`@retro-engine/build`:**

- New browser-safe `@retro-engine/build/rpak` subpath (reader / format / Web
  Streams compression / hash + `writeRpak`) so a browser runtime imports the
  `.rpak` code without the Node-only export pipeline.
- `emitWebBoot` forwards the asset URLs; `WebExportTarget` passes them when it
  packs a `.rpak` + manifest.

Verified: the `sample-game` export bundles the reader for the browser and boots —
`bootWebGame` fetches `manifest.json`, wires the source, and reports one manifest
entry in-browser; the `.rpak` serves + parses. `RpakAssetSource.read` is unit-tested
end-to-end over a real archive. A sprite-from-`.rpak` proof is phase C.
