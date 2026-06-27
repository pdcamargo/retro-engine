# Runtime morph targets (engine primitive)

Promotes `docs/roadmap/gltf.md` Phase B "Morph targets" and Phase 1 of `docs/roadmap/retrohuman.md`.
General-purpose blend-shape support: glTF morph targets drive a `MorphWeights` component, applied in
the vertex shader, animatable, editable in the inspector.

Delivery decided in ADR-0129 (storage buffer at `@group(3)`, gated on `storageBuffers`, WebGL2
deferred — mirrors ADR-0115 skinning).

## Slices

- **1.1 — data layer.** glTF: parse `primitive.targets` (POSITION/NORMAL deltas) + `mesh.weights` +
  `mesh.extras.targetNames`. `Mesh` carries a `MorphTargets` delta store. `MorphWeights` component
  (authored: `names`, `weights`) with reflection schema. glTF instantiation attaches `MorphWeights`
  to morphing mesh nodes. Unit tests.
- **1.2 — GPU delivery + WGSL (morphed, non-skinned).** Per-mesh delta buffer, per-entity
  weights/params buffer, `@group(3)` bind group; `#ifdef MORPHED` in `vs_main`/`vs_prepass`; queue a
  per-entity morphed draw. Bench for the per-frame weights upload / morph apply. Studio: spawn a
  morphing glTF, drive a weight, screenshot.
- **1.3 — animation + inspector.** Animation channel drives the whole `weights` array from a glTF
  weights sampler. Inspector renders one slider per target name.
- **1.4 — skinned + morphed variant.** `@group(3)` carries palette + deltas + weights together;
  morph-then-skin in the shader. Needed for RetroHuman facial expressions (Phase 5).

## Deferred (tracked, not in this item)

- WebGL2 data-texture morph path (ADR-0129).
- Motion-vector prepass for morphed meshes (ADR-0129).
- Instanced morphing (a crowd sharing one weight set).
