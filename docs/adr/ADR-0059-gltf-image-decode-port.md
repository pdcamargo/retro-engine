# ADR-0059: glTF Image-Decode Port

- **Status:** Accepted
- **Date:** 2026-06-01

## Context

ADR-0057 §3 commits the glTF importer to decoding `image/png` and `image/jpeg` "in v1" so imported
materials carry real textures, and §6 wires per-slot color space and samplers onto the engine `Image`.
But the engine `Image` is a CPU-side asset that holds **already-decoded** pixel bytes plus
`width`/`height`/`format` (the prepare system uploads `image.data` straight to the GPU with
`writeTexture` — there is no decode step downstream). The repo ships no PNG/JPEG decoder: it carries no
image-codec dependency, and ADR-0030 deferred file loaders entirely. So the mapping layer (ADR-0057
§4–§7) cannot build an `Image` from a glTF texture without *something* turning compressed bytes into RGBA
pixels — and ADR-0057 never sealed what that something is.

The constraints that shape the choice:

- ADR-0057 §2 deliberately keeps `@retro-engine/gltf` free of runtime parsing dependencies; codec
  dependencies are admitted only for the deferred WASM paths (Draco / KTX2 / meshopt), in their own
  phases.
- The data-mapping layer is meant to be unit-testable in isolation (the backlog item is scoped so the
  mapping is "testable independently of node-graph instantiation"), which a hard dependency on a
  platform image API (`createImageBitmap`) or a heavyweight codec works against.
- The engine is isomorphic: it runs in a browser and in the Tauri webview (both provide
  `createImageBitmap` + `OffscreenCanvas`), and in headless Bun for tests (which provides neither).

## Decision

Image decoding enters the mapping layer through an **injected port**, not a hard-wired codec.

- `@retro-engine/gltf` defines an `ImageDecoder` port — `(bytes: Uint8Array, mime: SupportedImageMime)
  => Promise<DecodedImagePixels>` — and the `DecodedImagePixels` shape `{ data, width, height, format }`
  (`format` a renderer-core base `TextureFormat`, e.g. `rgba8unorm`). The image-mapping code detects the
  MIME, rejects the still-deferred `image/ktx2`, and otherwise calls the port; it never references a
  concrete codec.
- A default decoder, `createImageBitmapDecoder`, ships in the same package, implemented over the standard
  `createImageBitmap` + `OffscreenCanvas` 2D path available in the browser and the Tauri webview — the
  environments the engine actually renders in. It throws a clear error if those globals are absent rather
  than pretending to decode. Headless Bun (tests, headless tooling) has no DOM image API; that is a known
  gap, covered precisely by the injection seam — tests and any headless consumer supply their own
  decoder (a stub in tests).
- The package stays dependency-free for decode: no PNG/JPEG codec is bundled. When KTX2 / Basis lands
  (its own deferred phase, ADR-0057 §9/§10), it slots in as another `ImageDecoder` implementation behind
  the same port, gated on `RendererCapabilities`, with no change to the mapping layer.

This is additive to ADR-0057 §3/§6 — it names the seam those sections implied — and supersedes nothing.

## Consequences

**Easier.** The mapping layer is pure and unit-testable with a trivial stub decoder; no image bytes need
to be valid in a unit test. Real models decode and render in the browser / studio out of the box via the
default decoder. The codec choice is deferred and swappable: KTX2 and any future format attach behind the
port without touching mapping or material code, and a consumer with special needs (a Node decoder, a
worker-thread codec) can inject one.

**Harder / accepted.** The default `createImageBitmap` decoder does not run under headless Bun, so an
end-to-end "decode a real PNG" assertion is not part of the package's `bun test` suite; decode is verified
visually in the playground / studio (a real webview) and the unit tests cover the mapping logic around an
injected decoder. The port adds one indirection between "I have image bytes" and "I have an `Image`" — the
price of keeping the package codec-free and the mapping testable.

## Implementation

- `packages/gltf/src/image-decoder.ts` — `ImageDecoder`, `DecodedImagePixels`, `createImageBitmapDecoder`.
- `packages/gltf/src/image-mapping.ts` — consumes the port; detects MIME, rejects `image/ktx2`, dedups.
- `packages/gltf/src/asset-mapping.ts` — `mapGltfAssets` threads the injected `ImageDecoder` through.
- `packages/gltf/src/index.ts` — re-exports the port type, `DecodedImagePixels`, and the default decoder.
- Builds on ADR-0057 (§3 png/jpeg decode, §6 per-slot color space + samplers, §7 image dedup).
