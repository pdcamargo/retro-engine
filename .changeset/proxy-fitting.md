---
'@retro-engine/engine': minor
---

feat(engine): garment proxy fitting — `.mhclo` parser + barycentric fit solve

The core of clothes/hair that follow body *shape* (RetroHuman Phase 4, ADR-0133). MakeHuman binds each
garment ("proxy") vertex to a body base-mesh triangle by barycentric weights + a scaled offset, so a
garment tracks the surface when the body is re-proportioned — not just posed.

- `parseMhclo` → `ProxyFitting` (`@retro-engine/engine`): parses a `.mhclo` proxy file into flat
  per-proxy-vertex arrays — base triangle (`triIndices`), barycentric `baryWeights`, `offsets`, and
  optional `x/y/z_scale` references. Handles both 9-field triangle bindings and single-index exact
  bindings; throws on malformed lines.
- `fitProxy(basePositions, fitting, out?)`: `pos = Σ wᵢ·base[triᵢ] + (sx·dx, sy·dy, sz·dz)`, where the
  per-axis scale is `|base[v1] − base[v2]| / den` (garment standoff tracks body proportions). Pure,
  `O(proxy vertex count)`, allocation-free with `out`. Benched (~48 µs for 16k proxy verts).

Reimplemented from the open/CC0 algorithm (MakeHuman code is GPL — not copied). Unit-tested: a garment
vertex follows its bound base triangle when the body morphs, and offsets scale with body proportions.
Studio garment wiring (load a proxy, re-fit on morph, skin to the shared skeleton) is the next slice.
