/**
 * Reserved slot for the mesh-driven local-space AABB writer.
 *
 * `VisibilityPlugin`'s documented system order is
 * `CalculateBounds → UpdateFrusta → VisibilityPropagate → CheckVisibility`.
 * `CalculateBounds` runs first because every later step depends on entities
 * having an `Aabb` to frustum-test against. This system anchors that slot at
 * its correct position in `'postUpdate'` — between `CameraPlugin`'s
 * computed-camera refresh and `VisibilityPlugin`'s frustum / propagation /
 * check trio.
 *
 * In the current phase there is no mesh-bearing component yet (`Mesh3d` lands
 * with the material system), so the body is intentionally empty — the
 * registration is what holds the order primitive. The body is replaced when
 * `Mesh3d` arrives: at that point it iterates every entity that has a mesh
 * handle but no manual `Aabb`, looks up the mesh, and writes the local-space
 * AABB derived from `Mesh.computeAabb` onto the entity.
 */
export const calculateBoundsSystem = (): void => {
  // Reserved slot — see TSDoc above. Body lands with `Mesh3d` / `Mesh2d` and
  // the auto-AABB pipeline.
};
