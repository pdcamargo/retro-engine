# Patchy dark IBL ambient on characters

- **Reported:** 2026-06-27
- **Severity:** High — characters look broken (dark, blotchy skin) under any scene with an environment map.
- **Status:** Open. Cause isolated to the environment-map IBL; fix not yet landed.

## Symptom

A skinned character (the Synty character in `retro-game-sample`, lit by `sky.hdr`)
renders with **sharp dark patches** on the face, body, and legs — e.g. a face whose
nose/mouth show correct skin tone while the cheeks and forehead, *at the same level
and facing*, are a flat dark blue-grey. It reads as "missing texture" / a shading
glitch. It is **independent of the sun**: rotating the directional light and raising
its intensity (and the ambient brightness) does not move or remove the patches.

## Confirmed root cause: the environment-map IBL

Isolated by live A/B tests in the studio (manipulating the scene via `studio_eval`,
not by trusting a single screenshot):

- **Albedo is correct.** An unlit view (material `emissive = baseColorTexture`,
  `baseColor = black`) shows the whole character correctly textured — skin, hair,
  eyes, clothing — with the dark patches **gone**. So it is the lit path, not the
  texture/UVs. (Atlas sampling at face vertices returns skin-tan `204,183,154`.)
- **Normals are correct.** The single-bone face vertex's skin matrix is a uniform
  scale × rotation — determinant `+100³`, orthogonal columns, equal lengths — so
  `skin * normal` preserves direction after `normalize`. No reflection / shear /
  non-uniform scale. (The FBX→GLB converter's 100× scale is uniform and not the
  cause.)
- **TAA and SSAO are ruled out.** AO is off (`ViewAo` 0 cameras). Removing the
  camera's `Taa` changes nothing about the dark patches (it only affects the
  separate ghosting/smear artifact — see the other bug).
- **It IS the env map.** Removing the camera's `EnvironmentMapLight` makes the dark
  patches vanish entirely — even with the sun at 0.1 and ambient at 0.1. So the
  darkness comes from the IBL term sampled by the (correct) normals.

## Why this is a bug, not a dark sky

A correct **diffuse IBL irradiance is smooth / low-frequency**: a face should get a
soft top-bright (sky) → bottom-dark (ground) gradient, not sharp dark cheeks beside
lit skin at the same facing. Sharp, blotchy darkness indicates the diffuse IBL is
not properly convolved (sampling a high-frequency mip / the raw environment by the
normal), and/or the specular prefilter × Fresnel over-darkens at grazing angles.

## Investigate / candidate fixes

1. **Diffuse irradiance smoothness (most likely):** confirm the diffuse ambient
   samples a properly convolved irradiance map, not the raw env cube or a sharp
   specular mip indexed by the normal. Check `EnvironmentPrefilter`,
   `EnvironmentCubeConverter`, `RenderEnvironmentMaps`, `ActiveEnvironment`
   (`packages/engine/src`) and the IBL term in `packages/engine/src/material/pbr.wgsl.ts`.
2. **Specular IBL + Fresnel at grazing angles:** verify the env specular term isn't
   over-darkening edges/cheeks (high Fresnel × a dark prefiltered sample).
3. **Scope:** determine whether this affects all meshes or is exaggerated on
   skinned/low-poly characters (compare a non-skinned mesh under the same env).

## Affected files

- `packages/engine/src/material/pbr.wgsl.ts` — IBL / environment ambient term.
- `packages/engine/src/` environment/IBL plugin(s) — `EnvironmentPrefilter`,
  `EnvironmentCubeConverter`, `RenderEnvironmentMaps`, `ActiveEnvironment`,
  `EnvironmentMapLight`.

## Verify

In the studio (manipulate via `studio_eval` + visual check; one instance only —
`studio_connected`'s command count is the freshness check; restart `bun run
tauri:dev` for engine src changes): with `sky.hdr` env **on**, the character's
face/body show a smooth ambient gradient with no patchy dark.

## Related

Separate from `scene-view-taa-ghosting.md` (skinned meshes lack skinning-aware
motion vectors → TAA ghosting/smears). These are two distinct skinned-character
rendering issues found together on 2026-06-27.
