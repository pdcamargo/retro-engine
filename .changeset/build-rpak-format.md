---
'@retro-engine/build': minor
---

feat(build): new @retro-engine/build package with the .rpak asset format (web export phase 1)

Introduces the export pipeline package and its delivery format:

- `.rpak` v1 — magic + version header → JSON table of contents
  (guid / offset / length / codec / uncompressedLength / hash) → concatenated
  per-entry blobs.
- `writeRpak` — packs assets (build time), gzip per entry via Web Streams with a
  `node:zlib` fallback, FNV-1a content hashes for integrity.
- `RpakReader` — reads an in-memory archive by GUID (slice → decompress →
  verify).
- `RangeRpakReader` — lazy, GUID-addressed reads over an injected byte-range
  fetch: `open()` pulls only the header + TOC, each `read()` only that asset's
  range — the basis for HTTP-Range asset streaming in the browser.
- `ExportTarget` / `ExportRegistry` — the pluggable-target interface the web
  adapter registers against.

The reader layer is browser-safe. Bundling user code + the web adapter that
emits a static site and writes the project `.rpak` land in a later phase.
