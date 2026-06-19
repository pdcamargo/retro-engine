# Asset thumbnails: on-disk cache + rendered geometry previews

- **Created:** 2026-06-19

## Context

ADR-0101 shipped the asset browser's thumbnail layer: a single 256-px master per asset,
generated lazily and async, sampled at every zoom — wired for image assets (decode →
texture → draw). Two parts of the decided end state were deliberately deferred to land
together, because they share a motivation.

## Scope when picked up

- **Rendered previews for meshes / scenes / prefabs.** An offscreen GPU pass per asset
  (a thumbnail camera + a default material + a light, rendered into a small target via the
  existing `ViewportTarget` pattern), so geometry assets read as their shape rather than a
  procedural placeholder. Loads the asset (mesh/scene) on demand through the streaming
  resolver (ADR-0100).
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
