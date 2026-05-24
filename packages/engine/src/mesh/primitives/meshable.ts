import type { Mesh } from '../mesh';

/**
 * Something that can produce a {@link MeshBuilder}.
 *
 * Implemented by 2D / 3D primitive types (`Cuboid`, `Sphere`, `Rectangle`,
 * …). Calling `.mesh()` returns a builder whose `.build()` emits the
 * concrete {@link Mesh} — the builder lets callers chain primitive-specific
 * tweaks (`Sphere::default().mesh().ico(5)`) before realising the geometry.
 */
export interface Meshable<B extends MeshBuilder = MeshBuilder> {
  mesh(): B;
}

/**
 * Realises a primitive's geometric data into a {@link Mesh}.
 *
 * The minimal contract is `.build()`. Concrete builders may layer extra
 * methods that mutate stored options and return `this`, mirroring Bevy's
 * builder shape (`mesh.ico(5).build()`, `mesh.resolution(64).build()`).
 *
 * Primitives produced by builders ship with `POSITION` + `NORMAL` + `UV_0`
 * attributes and an index buffer; the topology is `'triangle-list'` unless
 * otherwise documented.
 */
export interface MeshBuilder {
  build(): Mesh;
}
