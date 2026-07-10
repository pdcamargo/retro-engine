---
'@retro-engine/engine': minor
---

feat(engine): serve a built-in default font so text works with no asset

`TextPlugin` now auto-installs the engine's procedurally-generated SDF font (when
`Images` is present, i.e. alongside `ImagePlugin`/`CorePlugin`) and exposes it as
a new `DefaultFont` resource. `UiText` / `Text` with no explicit font fall back to
it, so text renders out of the box without dropping a `.font` asset on disk.

- New `DefaultFont` resource holding the built-in font handle.
- `installDefaultFont(app)` is now idempotent — it returns the existing default
  font if one is already installed (so an explicit call reuses the auto-installed
  one) and records it in `DefaultFont`.
