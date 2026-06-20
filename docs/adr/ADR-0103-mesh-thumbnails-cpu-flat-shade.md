# ADR-0103: Mesh thumbnails via a CPU flat-shade

- **Status:** Accepted
- **Date:** 2026-06-20

## Context

ADR-0101 shipped the thumbnail layer with image previews and left *rendered* previews for
meshes/scenes/prefabs deferred, because a GPU offscreen render per asset is invasive: it needs
a dedicated camera + light + material, render-layer isolation so it doesn't pollute the editor
views, and a per-frame capture queue woven into the live render loop. A mesh in the browser
still showed only the procedural placeholder.

## Decision

- **Mesh previews are rendered on the CPU into a 2D canvas, not via a GPU pass.** A `.rmesh`
  decodes to a `Mesh`; `renderMeshThumbnail` projects its triangles through a fixed 3/4
  orthographic view, flat-shades each face (one light + ambient), backface-culls, and
  painter-sorts back-to-front onto an `OffscreenCanvas`. The result uploads through the exact
  same canvas → texture → `ImTextureRef` path as image thumbnails — so it reuses the existing
  `ThumbnailService` machinery and touches nothing in the render loop.
- **Why CPU, not GPU:** a flat-shaded software render gives a recognizable, content-correct
  preview (you see the actual geometry, shaded) at a tiny fraction of the engineering cost and
  with zero coupling to the live per-camera render. A GPU PBR render is a quality upgrade, not a
  prerequisite — the `get` contract and upload path are unchanged when it lands.
- **Scope:** single-mesh `.rmesh` assets. glTF meshes (a multi-mesh `Gltf`), scenes, and prefabs
  keep their procedural placeholders; their rendered previews — and the GPU upgrade — stay in
  `docs/backlog/asset-thumbnail-cache-and-geometry-previews.md`.

## Consequences

- Mesh assets show a real shaded preview in the asset browser with no render-loop changes,
  verified on the sample's `cube.rmesh` (decodes to 24 verts / 12 tris; the 3/4 view yields the
  expected 6 front-facing triangles — the three visible cube faces).
- The software rasterizer is intentionally minimal (flat shading, no AA beyond the canvas's own,
  no textures). It is a preview, not a render; the GPU path supersedes it for fidelity later.
- Extends ADR-0101 (no change to its image path or cache decision); the on-disk cache remains
  deferred and now covers these CPU-rendered masters too.

## Implementation

- `apps/studio/src/thumbnails/mesh-thumbnail.ts` — `renderMeshThumbnail`
- `apps/studio/src/thumbnails/thumbnail-service.ts` — `.rmesh` branch in `generate`
- `apps/studio/src/project/project-browser.ts` — `.rmesh` marked thumbnailable
