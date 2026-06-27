---
'@retro-engine/engine': patch
---

fix(engine): materials fall back to a default texture while one is still loading

A material referencing a texture that hadn't finished loading (an async decode +
GPU upload — e.g. a loose PNG assigned to `baseColorTexture`) threw in
`resolveImageBinding` during `prepareMaterials`, aborting the whole render loop:
`could not resolve image handle N via RenderImages`. Assigning a texture and
reloading a scene that referenced it would crash on every frame.

`resolveImageBinding` now falls back to the default image (white / black /
normal-flat) when the material's own texture isn't uploaded yet, and only throws
when the *default* is also missing (the genuine "ImagePlugin not registered"
setup error). `prepareMaterials` re-prepares a material whose textures aren't all
ready each frame until they land — so it renders with the default, then swaps in
the real texture once it uploads, with no crash.
