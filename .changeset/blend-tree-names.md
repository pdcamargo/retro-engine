---
'@retro-engine/engine': minor
---

feat(engine): optional author-facing name on blend-tree motions

A `blend1d` / `blend2d` `Motion` may now carry an optional `name`. It is additive
and serialized in the `.ranimctrl` YAML (omitted when absent, so unnamed trees stay
clean and existing files are unaffected). Editors use it to label a nested blend
tree where it appears as a child of another tree — otherwise every nested tree reads
as a generic "1D/2D Blend Tree" and can only be identified by descending into it.
