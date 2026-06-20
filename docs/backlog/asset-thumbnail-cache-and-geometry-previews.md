# Asset thumbnails: on-disk cache + rendered geometry previews

- **Created:** 2026-06-19

## Context

ADR-0101 shipped the asset browser's thumbnail layer: a single 256-px master per asset,
generated lazily and async, sampled at every zoom — wired for image assets (decode →
texture → draw). ADR-0103 then added CPU flat-shaded previews for single-mesh `.rmesh`
assets. The remaining parts of the decided end state were deferred to land together.

## Scope when picked up

- **GPU-rendered previews + glTF/scene/prefab.** ADR-0103 covers single-mesh `.rmesh` on the
  CPU; still deferred: a higher-fidelity GPU pass per asset (a thumbnail camera + default
  material + light into a small target via the `ViewportTarget` pattern, render-layer-isolated),
  and previews for glTF meshes (a multi-mesh `Gltf`), scenes, and prefabs — loading the asset on
  demand through the streaming resolver (ADR-0100). Scenes/prefabs/glTF show procedural
  placeholders until then.
- **A git-ignored `.re/thumbnails/<guid>.<hash8>.png` disk cache**, keyed by GUID +
  content hash (invalidated on edit), under an in-memory LRU. The payoff is cold-open speed
  for the *expensive* rendered previews — image decode is cheap enough that in-memory
  regeneration is fine, which is why the two ship together.
- **Pre-warm with a cap** (warm the first N likely-visible assets after the device is up;
  lazy beyond), replacing the dropped boot-time pre-warm that raced device init.

## Acceptance

- A mesh / scene / prefab in the asset browser shows a rendered preview of its content.
- Previews persist to `.re/` and survive a session restart without regenerating, and a
  changed asset invalidates its cached thumbnail.
- A project with hundreds of assets opens responsively (no all-at-once decode/render storm).
