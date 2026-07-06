---
'@retro-engine/engine': patch
---

fix(engine): a mesh missing a shader-required vertex attribute no longer freezes the renderer

A mesh lacking an attribute the material's vertex shader declares (e.g. an imported glTF with no `TEXCOORD_0` under the PBR shader) used to build an invalid pipeline, which poisoned the frame's command encoder and froze the whole viewport with no surfaced error.

`MaterialPlugin` now checks, before building a pipeline, that the mesh's vertex layout provides every attribute the material requires (`Material.requiredMeshAttributes()`, defaulting to the standard `POSITION` / `NORMAL` / `UV_0` set the built-in PBR / unlit shaders consume). A mesh missing any required attribute has its draw skipped, with one dev warning per mesh, containing the blast radius to that one entity instead of the entire frame. Applies to the mesh, skinned, and (implicitly, unchanged) morph paths.

Unit-tested via `missingMeshAttributes` (the guard's decision over provided-vs-required attribute ids).
