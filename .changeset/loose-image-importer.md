---
'@retro-engine/engine': minor
---

feat(engine): loose image importer (PNG/JPEG/WebP → Image)

The `Image` asset kind and store already existed, but only `.hdr` had a decoder
wired — a dropped-in `.png` / `.jpg` / `.webp` had no loader, so a loose color
texture could not be loaded or assigned to a material (glTF-embedded textures
were unaffected; they decode through the glTF importer).

Adds `createImageImporter(decode?)` → `AssetImporter<Image>`, decoding a loose
PNG/JPEG/WebP into an sRGB color image (`rgba8unorm`) via `createImageBitmap` +
`OffscreenCanvas` (`createImageBitmapRgbaDecoder`, injectable for headless
environments). The studio registers it for `png`/`jpg`/`jpeg`/`webp`, so a loose
texture now loads through the asset server and binds like any other image.
