# Backlog: compute-shader GTAO

## Why

ADR-0054 ships ambient occlusion as a **fragment** GTAO pass — no compute or
storage-texture dependency, so it stays WebGL2-reachable. A compute
implementation is meaningfully faster (shared-memory depth/normal tiles, one
dispatch instead of a full-screen raster, no redundant per-pixel texel reloads
across the horizon march) but commits the feature to `computeShaders` +
`storageTextures` capabilities.

## Scope

- Add a compute variant of the GTAO + blur passes, gated on
  `RendererCapabilities.computeShaders` / `storageTextures` (per CLAUDE.md
  §5.4 — flagged from day 1, never assumed).
- Pick the path at AO prepare time: compute when the capability is present,
  fall back to the fragment pass otherwise. The forward-feedback `@group(3)`
  read binding and the `ViewAoTargets` lifecycle are shared by both.
- Tile the depth/normal reads into workgroup shared memory; emit AO into a
  storage texture.

## Done definition

The compute path lands behind the capability flag with the fragment path intact
as the WebGL2 fallback, and a bench shows the compute win on a capable device.
Deferred for sequencing/cost — the fragment pass is correct and reachable today;
this is a pure optimization, not a missing capability.
