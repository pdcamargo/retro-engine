# Morph-target follow-ups (deferred)

The runtime morph-target feature shipped (RetroHuman Phase 1, ADR-0129): glTF blend-shape import, the
`MorphWeights` component, GPU delivery (storage buffer at `@group(3)`), animation channels, inspector
sliders, and the skinned+morphed combined variant. These refinements were deliberately deferred.

- **WebGL2 data-texture morph path.** Delivery is storage-buffer only, gated on `storageBuffers`
  (ADR-0129). On WebGL2 a morphed mesh draws from base geometry (skinned+morphed doesn't render
  there, same as skinning). The WebGL2-reachable path is a data texture (`texture_2d_array`, Bevy's
  approach); declared, not built.
- **Prepass participation for morphed meshes.** Morphed entities are excluded from the rigid queue
  that feeds the depth/normal/motion-vector prepass, so they skip it entirely (they self-depth in the
  main pass, which is correct). Consequence: SSAO/normal-prepass don't see the morphed surface →
  speckling on morphed meshes under SSAO; no morph-aware motion vectors. ADR-0129 frames the eventual
  design (morph applied in the depth/normal prepass).
- **Per-entity morph GPU buffer cleanup.** `MorphGpu` no longer eagerly frees a despawned entity's
  weights/params buffers (the eager sweep conflicted with the morph-only and combined queues sharing
  one entity map). Small leak (16 B + N×4 B per despawned morph entity). Fix with a despawn/removal
  hook or a frame-epoch sweep owned by a single system.
- **Instanced morphing.** Morphed (and skinned+morphed) entities draw one instance each — they are
  unique, not crowds. A crowd sharing one weight set would be an additive variant.
- **Multi-primitive morph animation.** glTF `weights` channels target the mesh node; `MorphWeights`
  on a multi-primitive node lives on the per-primitive children, which the node-id-addressed track
  does not reach. Single-primitive meshes (the common Blender shape-key export) work.

Related: `docs/bugs/mesh-without-uv-freezes-renderer.md` (a UV-less mesh freezes the renderer —
pre-existing, surfaced during morph verification).
