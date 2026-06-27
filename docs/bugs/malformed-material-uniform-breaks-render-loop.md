# Bug: a malformed material field value breaks the whole render loop

## Symptom

Constructing a `StandardMaterial` with a wrong-shaped field value — e.g.
`emissive: [1, 1, 1]` (3 components) where the uniform schema expects a `vec4f`
— is accepted by the constructor without error. The next frame, the material's
uniform packer throws `Expected vec4 (array, Float32Array, or {x,y,z,w}) for
vec4f uniform field` from `prepareMaterials` (`packages/engine/src/material/material-plugin.ts`),
which propagates out through `renderFrame` → `advanceFrame` → the frame loop.
The throw is uncaught, so rendering stops for the entire app (the viewport
freezes / the studio MCP bridge drops), not just for the offending material.
Recovery requires a restart.

## Root cause

Two gaps compound:

1. **No constructor validation.** `StandardMaterial`'s constructor stores
   `emissive` (and likely the other vec fields) as given, without checking /
   padding the component count, so a malformed value is accepted silently and
   only fails much later at uniform-pack time.
2. **No per-material error isolation in the render loop.** `prepareMaterials`
   iterates the material store and packs each one's uniforms; a single throwing
   material aborts the whole prepare pass (and the frame), rather than being
   skipped (and logged) so the rest of the scene keeps rendering.

This is the same *class* of fragility as `mesh-without-uv-freezes-renderer.md`:
one bad GPU input takes down all rendering instead of being contained.

## Fix sketch

- Validate / normalize vec fields in the `StandardMaterial` constructor (reject
  or pad to the declared width) so a malformed value fails fast at construction
  with a clear message.
- Make `prepareMaterials` resilient: wrap each material's pack in a try/catch,
  log once per offending handle, and skip it (fall back to a default material)
  so one bad material cannot freeze the frame loop.

## Partially mitigated

The **editor / MCP path** that triggered this is now guarded: `decodeValue`
(`packages/reflect/src/codec.ts`) coerces a numeric string and throws a clear
error for a non-numeric value on a `number` field, so a field-set can no longer
store a string in an `f32` uniform. The underlying fragility — *any* malformed
material value aborting the whole prepare pass / frame loop — remains: the
constructor-validation + per-material `try/catch` in the fix sketch are still
worth doing for non-editor paths (direct code, a hand-edited `.remat`).

## How it was found

Hit while assigning textures via `studio.eval` during the texturing
investigation (passed a 3-component `emissive`). Not reachable through the normal
authoring paths today (glTF import and the `StandardMaterial` factory defaults
produce valid vec4s), but a code/MCP consumer can trigger it.
