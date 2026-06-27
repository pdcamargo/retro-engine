# ADR-0133: Garment proxy fitting — barycentric body-surface binding

- **Status:** Accepted
- **Date:** 2026-06-27

## Context

RetroHuman Phase 4 dresses a customized body: a garment ("proxy" — shirt, hair, shoes) must follow
the body's **shape**, not just its pose. When the character creator widens the torso or lengthens the
legs, the shirt must move with the surface — pose-only skinning cannot do this, because the body
deformation is morph (vertex) change, not joint motion.

MakeHuman solves this with `.mhclo` proxy files: each garment vertex is bound to a triangle of the
body base mesh by barycentric weights plus a per-axis-scaled offset, so it rides the body surface.
The format and algorithm are open/CC0; the MakeHuman *code* is GPL/AGPL (not copied — reimplemented).

The open question is fidelity: full barycentric body-surface fitting vs a cheaper approximation
(e.g. nearest-vertex snap, or a single rigid transform).

## Decision

**Full barycentric body-surface fitting**, faithful to `.mhclo`. Each proxy vertex `i`:

```
pos_i = w1·base[t1] + w2·base[t2] + w3·base[t3] + (sx·dx, sy·dy, sz·dz)
```

- `t1,t2,t3` are base-mesh vertex indices (a triangle), `w1,w2,w3` barycentric weights, `dx,dy,dz`
  an offset. An "exact" binding (`.mhclo` single-index line) degenerates to `t1=t2=t3`, `w=(1,0,0)`,
  zero offset.
- `(sx,sy,sz)` is a per-axis scale `|base[v1] − base[v2]| / den` from the header's `x/y/z_scale`
  references, so the garment's standoff tracks the body's proportions; absent → `1`.
- Parsed into `ProxyFitting` (flat parallel arrays: `triIndices`, `baryWeights`, `offsets`, optional
  `scale`), one entry per proxy vertex in proxy-mesh order. `fitProxy(basePositions, fitting, out?)`
  evaluates it — pure, `O(proxy vertex count)`, allocation-free with `out`, benched.

A cheaper approximation is rejected: the whole point is shape-follow, and nearest-vertex/rigid fits
visibly tear or float garments off a re-proportioned body. Barycentric is the correct primitive and
not meaningfully more expensive (one weighted triangle read + scaled offset per vertex).

The proxy's own geometry (vertices/faces/UVs) is an ordinary mesh loaded **in proxy-vertex order**
(the `obj_file` the `.mhclo` names, via `parseObjBaseMesh`), so binding entry `i` pairs with proxy
vertex `i`. A garment renders as a sub-mesh and, skinned to the shared skeleton, gets pose-follow free
(ADR-0114); shape-follow comes from re-running `fitProxy` after a body morph.

## Consequences

- Garments follow body customization: re-fit after a morph and the shirt tracks the new shape. This
  is the Phase 4 deliverable.
- Fitting is edit-time + CPU, consistent with the character creator (ADR-0131). A body slider drag
  recomposes the body then re-fits each garment — both benched on the interaction path.
- A proxy is topology-locked to the base it was authored against (its triangle indices). A binding
  applied to a foreign base yields `NaN` for stray vertices rather than silent corruption; matching
  base + proxy is the caller's responsibility (as with morph targets, ADR-0130).
- `.mhclo` proxies are not staged in `vendor/` and are fetch-on-demand; tests/verification use small
  synthetic fixtures. A discoverable `.mhclo` asset kind + studio garment wiring is the next slice.
- Baking a dressed character (body + fitted garments into one shippable asset) builds on this + the
  bake primitive (ADR-0132); deferred until the studio garment flow lands.

## Implementation

- `packages/engine/src/proxy/proxy-fitting.ts` — `ProxyFitting`, `ProxyAxisScale`, `parseMhclo`.
- `packages/engine/src/proxy/proxy-fit.ts` — `fitProxy`.
- `packages/engine/bench/proxy-fit.bench.ts` — re-fit bench.
- Consumes the base mesh (`parseObjBaseMesh`, ADR-0131) and the body composition (ADR-0131).
