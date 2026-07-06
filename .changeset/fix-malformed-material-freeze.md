---
'@retro-engine/engine': patch
---

fix(engine): a malformed material value no longer freezes the render loop

Two compounding gaps closed (see the render-loop-freeze bug):

- **`StandardMaterial` validates its vec fields at construction.** `baseColor` / `emissive` are coerced to a length-4 `Vec4` — a short value is padded from the default (so `emissive: [1, 1, 1]` becomes `[1, 1, 1, 0]`), and a non-array-like or non-numeric value throws a clear error *at construction* instead of deep in the uniform packer mid-frame.
- **`MaterialPlugin.prepareMaterials` isolates per-material failures.** Each material's uniform pack is wrapped in try/catch: a throwing material is logged once and skipped (the rest of the scene keeps rendering) rather than aborting the whole prepare pass and freezing the frame loop.

Verified by unit tests (constructor padding/rejection; a deliberately malformed material is skipped while a good one still prepares).
