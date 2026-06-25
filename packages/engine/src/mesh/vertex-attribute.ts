import type { VertexFormat } from '@retro-engine/renderer-core';

/**
 * Numeric identity for a vertex attribute. Branded so plain `number`s cannot be
 * passed where an attribute id is expected. Equality is plain numeric
 * comparison.
 *
 * The well-known attribute ids ({@link MeshAttribute}) mirror Bevy verbatim:
 * `POSITION = 0`, `NORMAL = 1`, `UV_0 = 2`, `TANGENT = 4`, `COLOR = 5`. New
 * attributes should pick fresh ids outside that range; ids in `[0, 1024)` are
 * reserved for engine-defined slots, ids in `[1024, ∞)` are free for plugin /
 * user attributes.
 */
export type MeshVertexAttributeId = number & { readonly __meshVertexAttributeId: unique symbol };

/** Cast a plain number to a {@link MeshVertexAttributeId}. */
export const meshVertexAttributeId = (id: number): MeshVertexAttributeId => id as MeshVertexAttributeId;

/**
 * A typed slot in a {@link Mesh}'s per-vertex layout.
 *
 * The attribute pairs a stable numeric id (for fast map lookup and consistent
 * cross-mesh identity) with a human-readable name (for diagnostics + glTF
 * round-tripping) and a byte format (driving the vertex-buffer layout the
 * pipeline reads).
 *
 * `shaderLocation` is intentionally not part of the attribute — it's assigned
 * by the material / pipeline that consumes the mesh, not by the mesh itself.
 * The same attribute may bind to `@location(0)` in one shader and
 * `@location(3)` in another.
 */
export interface MeshVertexAttribute {
  readonly name: string;
  readonly id: MeshVertexAttributeId;
  readonly format: VertexFormat;
}

/**
 * Construct a {@link MeshVertexAttribute}. Helper around the literal struct
 * shape that brands the `id` field.
 */
export const meshVertexAttribute = (name: string, id: number, format: VertexFormat): MeshVertexAttribute => ({
  name,
  id: meshVertexAttributeId(id),
  format,
});

/**
 * Engine-defined vertex attributes.
 *
 * Ids match Bevy's well-known slot ids so a future glTF importer can map
 * primitive attributes through without a remap table:
 * `POSITION = 0`, `NORMAL = 1`, `UV_0 = 2`, `TANGENT = 4`, `COLOR = 5`,
 * `JOINT_WEIGHT = 6`, `JOINT_INDEX = 7`. Id `3` is intentionally skipped —
 * Bevy reserves it for a second UV channel which we will add when a consumer
 * requires it.
 *
 * `JOINT_INDEX` carries four joint indices per vertex as `uint16x4` (read in
 * the shader as `vec4<u32>`); `JOINT_WEIGHT` the four matching blend weights as
 * `float32x4`. They appear on a mesh only when it was imported with skinning
 * data — a non-skinned mesh simply omits them.
 */
export const MeshAttribute = {
  POSITION: meshVertexAttribute('Vertex_Position', 0, 'float32x3'),
  NORMAL: meshVertexAttribute('Vertex_Normal', 1, 'float32x3'),
  UV_0: meshVertexAttribute('Vertex_Uv_0', 2, 'float32x2'),
  TANGENT: meshVertexAttribute('Vertex_Tangent', 4, 'float32x4'),
  COLOR: meshVertexAttribute('Vertex_Color', 5, 'float32x4'),
  JOINT_WEIGHT: meshVertexAttribute('Vertex_Joint_Weight', 6, 'float32x4'),
  JOINT_INDEX: meshVertexAttribute('Vertex_Joint_Index', 7, 'uint16x4'),
} as const;
