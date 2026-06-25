# Scene View TAA ghosting / black smear with motion

- **Reported:** 2026-06-25
- **Severity:** High — the Scene View becomes unusable as motion accumulates.
- **Status:** Open. Root cause confirmed; fix not yet landed.

## Symptom

In the studio **Scene View** (editor viewport), rendering a glTF model produces a black
smear that progressively dirties the whole frame. It gets worse the more anything moves —
the model animating, the camera orbiting, or the model being translated — until the view is
unusable. The **Game View does not show it**.

## Confirmed root cause

It is **TAA (temporal anti-aliasing) history feedback/ghosting on the editor camera**, proven
by an A/B test in the live studio: with the editor camera's `Taa` component removed, the smear
disappears entirely and the (still-animating) model renders clean; re-adding `Taa` brings the
smear back. See `screenshots/bug-taa-on.png` vs `screenshots/bug-taa-off.png`.

Why it shows only in the Scene View: the editor camera is spawned with `new Taa()` **and no
skybox** (`apps/studio/src/editor-camera.ts:79-95`), clearing to a flat color. The game camera
has a `Skybox`, which overwrites background pixels every frame (`loadOp: 'load'`) and keeps the
TAA history fresh, masking the artifact. With no skybox, stale/black history is fed back through
the TAA resolve and reprojected by motion vectors, so it accumulates and smears with motion.

The artifact covers the model area too (not just background), which points at **motion-vector
ghosting**: animated skinned meshes (Phase 0/2) almost certainly do not write skinning-aware
motion vectors — the motion-vector prepass uses the rigid model matrix, so a vertex moved by a
bone reports ~zero motion, and TAA reprojects its history from the wrong place. Camera-motion
reprojection and/or the history neighborhood clamp may also be too weak to reject the stale
samples.

This is **pre-existing** (the editor camera has always run TAA without a skybox); skeletal-
animation Phase 2 only made it constant by animating the rig every frame.

## Reproduce

1. Open `level_01` with the glTF character in the Scene View.
2. Orbit the camera, translate the model, or play any bone animation.
3. Watch the black smear build up and persist.

## Candidate fixes (ranked)

1. **Skinning-aware motion vectors** (correct, larger): the motion-vector prepass for skinned
   meshes must use the previous-frame skinned positions (previous joint palette), not the rigid
   model matrix, so animated geometry reprojects correctly. Touches the prepass motion-vector
   path and the skinning palette (a previous-frame palette buffer).
2. **Tighten TAA history rejection** (`packages/engine/src/taa/taa.wgsl.ts` resolve): variance/
   neighborhood clipping of the reprojected history so stale dark samples are clamped to the
   current neighborhood. Verify the existing 3×3 clamp is actually applied and tight enough.
3. **Background fill for the editor camera**: give the Scene View a skybox or an explicit
   full-frame background fill so background pixels stay fresh. Hides the background portion but
   not model-area ghosting (so not sufficient alone).
4. **Disable TAA on the editor camera** (`editor-camera.ts`): remove `new Taa()`. Trivial and
   makes the view usable immediately, at the cost of anti-aliasing in the Scene View. A stopgap,
   not a real fix.

A real fix is likely (1) + (2). Each needs visual verification in the studio across sustained
camera and model motion, not just a static frame.

## Affected files

- `apps/studio/src/editor-camera.ts` — editor camera spawns `Taa`, no skybox.
- `packages/engine/src/taa/` — TAA resolve + history (`taa.wgsl.ts`, `taa-node.ts`, `taa-plugin.ts`, `view-taa-targets.ts`).
- `packages/engine/src/prepass/` — motion-vector prepass (skinning-unaware).
- `packages/engine/src/skinning/` — joint palette (a previous-frame palette is needed for fix 1).
