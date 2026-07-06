# @retro-engine/build

Retro Engine's export pipeline: pluggable `ExportTarget`s and the `.rpak` asset
package format. Bun/Node for the writer and targets; the `.rpak` reader is
browser-safe (Web Streams + typed arrays) so the runtime can stream assets by
HTTP Range.

Phase 1 ships the `.rpak` format: `writeRpak` (build-time), `RpakReader`
(in-memory), and `RangeRpakReader` (lazy, GUID-addressed reads over an injected
byte-range fetch), plus the `ExportTarget`/`ExportRegistry` interface. The web
adapter (bundle user code + emit a static site + `.rpak`) is a later phase.

See `docs/roadmap/web-build-target.md` and
`docs/adr/ADR-0151-web-export-and-rpak.md`.
