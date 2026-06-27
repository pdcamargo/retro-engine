---
'@retro-engine/engine': minor
'@retro-engine/editor-sdk': minor
---

feat(engine): garment asset kind + studio fitting — clothes follow body shape

Completes RetroHuman Phase 4 (ADR-0133): garments load as assets and follow the body when it morphs.

- `ProxyPlugin` registers a `.mhclo` asset kind (`ProxyFitting`, discoverable, category `garment`):
  `ProxyFittings` store + `createProxyFittingImporter` (uses `parseMhclo`). The garment's geometry
  loads as an ordinary `ObjMesh` (vertex-order, so binding `i` pairs with proxy vertex `i`).
- `@retro-engine/editor-sdk`: a `'garment'` `AssetType` (shirt icon) for the studio browser.
- Studio character-creator panel: discovers `garment` assets, loads each fitting + its proxy mesh,
  spawns it as a sub-mesh, and re-fits (`fitProxy`) onto the live body on every morph edit.

Verified live: a garment bound to nose-region base verts moved with the body (vertex Δy = −0.564 when
the nose morphed), renderer healthy. Skeleton-driven pose-follow comes free once the shared skeleton is
wired (Phase 5).
