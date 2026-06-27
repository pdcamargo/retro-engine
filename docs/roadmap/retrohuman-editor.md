# RetroHuman editor — a dedicated authoring view that bakes to a GLB asset

- **Created:** 2026-06-27
- **Status:** Planned

## Goal

A dedicated **RetroHuman editor** — a dialog / fullscreen view, *not* in-scene
editing — for authoring a humanoid: drag the face/body sliders, dress it, see it
textured (skin/eyes/hair) live, then **Save**, which bakes the result into a
**shippable GLB** (mesh + skeleton + skin) plus its **material(s) + textures** as
ordinary project assets. You then drop that GLB into a scene like any other model;
it animates/retargets through the existing stack. The point: a humanoid is
authored in its own tool and *exported* as a baked asset, rather than being a
live, slider-driven thing living in the scene graph.

This wraps the existing character-creator UX (currently a side panel that spawns a
preview into `/scene`) into a focused modal/fullscreen surface and adds the
save→export pipeline.

## Why a dedicated view

- Editing a 19k-vert morph/skin character in the scene viewport, alongside
  gameplay entities, is the wrong surface — it pollutes the scene, the sliders are
  runtime-only state, and the character isn't a real asset until baked.
- The editor's *output* is what belongs in a scene: a baked GLB + materials. The
  authoring sliders are tooling, not scene data.

## What already exists (reuse)

- Morph targets + CPU compose + edit-time bake (ADR-0129 / 0131 / 0132), proxy
  fitting (ADR-0133), the rigged/skinned preset + retarget-ready skeleton
  (ADR-0134), the `/character-creator` panel (`apps/studio/src/panels-character-creator.ts`).
- Material + texture editing, the loose-image loader, and `saveAsset` (ADR-0135) —
  the machinery to give the character textured materials and persist them.

## Slices

- **1 — Dedicated editor surface.** Lift the character-creator UX out of the
  right-hand panel / scene preview into a modal or fullscreen RetroHuman view with
  its own isolated preview (its own camera + render target, not the gameplay scene).
- **2 — Textured + full sliders.** Promote
  `docs/backlog/retrohuman-textured-and-sliders.md`: textured skin/eyes/hair and the
  curated region + macro slider set, shown live in the editor.
- **3 — Save → bake to assets.** "Save" freezes the current sliders into a baked
  mesh (`bakeMorphedMesh`) **and** exports a GLB (mesh + skeleton + skin) plus its
  materials/textures as project assets. Depends on the GLB exporter in
  `docs/backlog/baked-character-persistence.md` (engine has a glTF importer, no
  exporter yet) — promote/seal that first; skeleton + skin export is the new part.
- **4 — GLB as a first-class asset.** The exported GLB drops into a scene like any
  model, instantiates with its skeleton, and retargets foreign clips (ADR-0122–0127).
  Re-opening it in the editor (round-trip authoring) is a stretch goal — decide
  whether the editor persists its *authoring* state (slider values) separately from
  the baked GLB.

## Open questions

- **Authoring state vs baked output.** Does the editor save a `.retrohuman`
  authoring doc (slider values + garment/texture choices) so a character is
  re-editable, with the GLB as the baked export? Or is the GLB the only artifact
  (bake is one-way)? Leaning re-editable authoring doc + baked GLB export.
- **GLB exporter scope** — minimal (positions/normals/uv/indices/material) vs full
  (skeleton + skin + morph targets). Skeleton+skin is required for an animatable
  RetroHuman; sealed in the baked-character-persistence promotion.
- **Modal vs fullscreen vs dockable** for the editor surface (Slice 1).

## Links

- ADR-0129–0134 (RetroHuman), ADR-0135 (editor asset editing)
- `docs/backlog/retrohuman-textured-and-sliders.md` (Slice 2 content)
- `docs/backlog/baked-character-persistence.md` (Slice 3 GLB export)
- `vendor/makehuman/` — CC0 base mesh, targets, rigs, skin/eye/hair assets
