---
'@retro-engine/engine': minor
---

feat(engine): skeletal-animation Phase 3 — animation layers + avatar masks

Per ADR-0120, a rig can play several animations at once, each scoped to part of the body and
combined by replacement or by adding a delta — Unity-style layers, masks, and additive blending.
Pure pose math on top of the Phase-2 pipeline (ADR-0118): no new GPU work beyond Phase 0. The
existing `AnimationPlayer` and `AnimationControllerPlayer` paths are untouched and drive entities
that don't opt into layers.

**`AvatarMask` asset** (`avatar-mask.ts`, `avatar-mask-asset.ts`) — a reusable, shareable
`.ramask` asset (via the asset-kind flow): a **binary** include set of bone target ids, keyed on
the same `AnimationTarget.id` clips bind through. A layer with a mask contributes only to the
bones in the set; masked-out bones keep the lower layers' value. This is the generic/Transform
mask; the Unity humanoid body-part toggle is deferred to Phase 5 (it needs the canonical humanoid
avatar). The studio mask-authoring UI is out of scope — masks are driven via code/MCP for now.

**`AnimationLayers` component** (`animation-layers.ts`) — an ordered layer stack (bottom/base
first). Each layer carries a `weight`, a blend mode (`override` | `additive`), an optional `mask`
handle, and a motion `source` that is **either a clip or a full `AnimationController`** (so a
bare-clip layer stays cheap, and a layer can host its own state machine). Transient per-layer
playback (clip cursor, controller state) lives in the `AnimationLayerRuntimes` resource; the
additive reference (bind) pose lives in the `ReferencePoses` resource — both derived, never
serialized.

**Layer composition** (`layer-blend.ts`, `animation-system.ts`) — the layered driver builds one
shared slot layout across every bone any layer animates, evaluates each layer bottom-up into a
pose with the Phase-2 machinery, then composes into a single accumulator gated per bone by the
layer's mask, and commits once:

- `composeLayerOverride` — `lerp(below, layer, weight)` (sign-aligned nlerp for rotation) on
  masked bones; the base layer onto an empty accumulator is the same operation.
- `composeLayerAdditive` — adds the delta from the **glTF bind pose** (`t += w·Δt`,
  `r = base · nlerp(identity, ref⁻¹·clip, w)`, `s *= lerp(1, clip/ref, w)`), captured lazily from
  each bone's rest `Transform`.

Adds a `layer-blend` bench (cost grows with bones × layers).
