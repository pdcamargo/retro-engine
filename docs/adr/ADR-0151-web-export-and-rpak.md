# ADR-0151: Web export target and the `.rpak` asset package format

- **Status:** Accepted
- **Date:** 2026-07-06

## Context

A game built on Retro Engine can only run inside the studio today — there is no
pipeline that turns a project into a deployable artifact. Shipping a complete
game (the P0 north star) needs at minimum a **web target**: a static site the
engine + the user's bundled code run in, and a way to deliver the project's
assets to that runtime.

Assets are already keyed by GUID and located through a manifest (ADR-0065/0066).
Delivering hundreds of loose files over HTTP is slow (one request each) and loses
integrity guarantees. A single packed archive the runtime streams by byte range
fits the existing GUID model far better: one file, lazy per-asset reads, content
hashes for integrity.

Constraints:

- **The reader runs in the browser at runtime.** It must be browser-safe — no
  Node built-ins. Web Streams (`CompressionStream`/`DecompressionStream`) and
  typed arrays cover compression and parsing in Bun, Node 18+, and browsers
  alike, so the format layer needs no platform shims.
- **The writer runs at build time** (Bun/Node) and shares the same format layer.
- **Lazy delivery.** The runtime should fetch the header + table of contents
  once, then read each asset's bytes on demand via HTTP Range — never the whole
  archive up front.
- **Pluggable targets.** Web is first; desktop/other targets follow. Export is a
  registry of `ExportTarget`s, not a hard-coded web path (composition, ADR-0001).

## Decision

Create **`@retro-engine/build`** (Bun/Node for the writer/targets; the reader
subset is browser-safe), built in phases. This ADR fixes the architecture and the
`.rpak` format; phase 1 implements the format.

### `.rpak` format (v1)

A little-endian binary layout:

```
[0..3]    magic  = "RPAK" (0x52 0x50 0x41 0x4B)
[4..7]    u32    format version (= 1)
[8..11]   u32    TOC byte length (N)
[12..12+N) UTF-8 JSON table of contents
[12+N..)  blob region — concatenated per-entry blobs
```

The TOC is `{ version, entries: [{ guid, offset, length, codec, uncompressedLength, hash }] }`
where `offset`/`length` locate the (possibly compressed) blob **within the blob
region** (i.e. relative to `12 + N`), `codec` is `'none' | 'gzip'`,
`uncompressedLength` is the decoded size, and `hash` is an FNV-1a hash of the
**uncompressed** bytes for integrity. Keeping the TOC as JSON at a known offset
lets a Range reader fetch `[0, 12)` (header) → `[12, 12+N)` (TOC) → then only the
byte range of each asset it needs.

- **Writer** (`writeRpak`, build-time): compresses each entry per its codec,
  lays out the blob region, emits the header + TOC + blobs as one `Uint8Array`.
- **Readers** (runtime, browser-safe):
  - `RpakReader` over an in-memory `Uint8Array` — `has(guid)` / `read(guid)`
    (slice → decompress → verify hash).
  - `RangeRpakReader` over an injected `RangeFetch(start, end)` — `open()` reads
    the header + TOC; `read(guid)` fetches only that entry's byte range. The
    concrete HTTP-Range `fetch` wiring is injected by the web runtime (phase 2),
    so the format layer stays transport-agnostic and unit-testable.

Compression uses the Web Streams `CompressionStream`/`DecompressionStream`
(`'gzip'`), available in Bun, Node, and browsers — no Node `zlib` dependency.

### Export targets

An `ExportTarget` is `{ name, export(ctx): Promise<ExportResult> }`; an
`ExportRegistry` holds them by name. The **web adapter** (phase 2) bundles the
user code (Bun bundler, engine externalized), emits `index.html` + the engine +
user bundle, and writes the project's assets into a `.rpak` beside a manifest.

## Consequences

- The delivery format lands first as a pure, exhaustively-tested layer (write →
  read-by-GUID, gzip round-trip, hash integrity, Range-only reads) with zero
  platform or GPU dependency — verifiable headlessly today.
- Web Streams compression keeps the reader browser-native with no polyfill, at
  the cost of async reads (fine — asset loading is already async).
- One archive + Range reads fits the existing GUID/manifest model and scales to
  large projects without a request-per-asset penalty.
- The `ExportTarget` registry keeps desktop/console/other targets additive; the
  web target is the first registration, not a special case.
- Bundling the user's code (Bun.build, engine externalization, code-splitting)
  and the "runs in a browser" end-to-end proof are phase 2 — deferred for
  sequencing, not scope; the format they depend on is ready.

## Implementation

- `packages/build/src/rpak-format.ts` — magic/version constants, TOC types, header codec.
- `packages/build/src/rpak-compression.ts` — `gzip`/`gunzip` via Web Streams.
- `packages/build/src/rpak-hash.ts` — FNV-1a content hash.
- `packages/build/src/rpak-writer.ts` — `writeRpak`.
- `packages/build/src/rpak-reader.ts` — `RpakReader`, `RangeRpakReader`, `RangeFetch`.
- `packages/build/src/export-target.ts` — `ExportTarget` / `ExportRegistry` (interface; web adapter phase 2).
