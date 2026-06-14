---
'@retro-engine/editor-sdk': patch
---

fix(editor-sdk): draw vector-field axis chip letters in a dark color

The X / Y / Z letters on `dragNumber` / `vec3` axis chips were drawn in near-white over the bright red / green / cyan chip fills, leaving them effectively unreadable. They now use the palette's darkest tone, restoring contrast against every axis chip color.
