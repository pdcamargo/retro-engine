# RetroHuman: textured (skin/eyes/hair) + the full curated slider set

The RetroHuman preset spawns a rigged, skinned, deformable humanoid (Phase 5,
ADR-0134), but two pieces of the "MetaHuman feel" are still missing — both now
*unblocked* by the editor-asset-editing work (ADR-0135 + the loose-image loader),
which gives us texture loading + assignment.

## 1. Textured RetroHuman (skin / eyes / hair)

Today the preset uses a flat skin-tone `StandardMaterial` (no texture). MakeHuman
ships **CC0** skin textures (and eye / eyebrow / hair assets) keyed to `base.obj`'s
UVs. Wanted:

- A **skin material** on the body: a CC0 MakeHuman skin albedo (+ normal / roughness
  where available) assigned to the base mesh's material. The loose-image loader +
  the material editor (ADR-0135) make this a straight assignment now.
- **Eyes + hair** as separate sub-meshes with their own textured materials (MakeHuman
  has eye/eyebrow/hair geometry under `vendor/makehuman/`; eyebrows already exist as
  glTF nodes on the Synty rig — confirm the MakeHuman pipeline). These attach to the
  skull bone and skin/parent with the head.
- Fetch the skin/eye/hair CC0 assets via `vendor/makehuman/fetch.sh` and stage them
  into the project (decide the asset model, mirroring base.obj / rig staging).

## 2. The full curated slider set

The `/character-creator` panel currently renders **one raw `[0,1]` slider per
`.target` asset** present in the project (only the test targets are staged). The
MetaHuman-feel set has two layers (cf. `docs/roadmap/retrohuman.md`, retired):

- **Region detail sliders** — the ~290 face `.target`s (nose / ears / cheek / chin /
  eyes / mouth / forehead, etc., under `vendor/makehuman/targets/`). Each is a
  *directional* morph (`*-incr` / `*-decr`); curate them into bidirectional named
  sliders grouped by region (`target.json` regions), not a flat list of half-targets.
- **Macro sliders** — age / weight (fat) / muscle / gender / height / proportions.
  These are **not** single `.target`s: MakeHuman blends a *matrix* of targets across
  the age×gender×weight×muscle axes. Needs the full target set
  (`vendor/makehuman/fetch.sh --full`, with `macrodetails/`) **and** a macro-blending
  layer the panel drives as single sliders. This is the substantive new system.

## Notes

- Builds on: the morph primitive + CPU compose + bake (ADR-0129/0131/0132), proxy
  fitting (ADR-0133), the rigged preset (ADR-0134), and the material/texture editing
  + loose-image loader (ADR-0135).
- Related: `docs/backlog/morph-target-followups.md`,
  `docs/backlog/baked-character-persistence.md`.
- This is the content/UX layer the **RetroHuman editor** roadmap
  (`docs/roadmap/retrohuman-editor.md`) hosts; promote slices from there.
