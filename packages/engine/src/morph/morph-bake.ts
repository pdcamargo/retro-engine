import { u16Indices, u32Indices } from '../mesh/indices';
import { Mesh } from '../mesh/mesh';
import { MeshAttribute } from '../mesh/vertex-attribute';
import { composeMorphedPositions, type WeightedMorphTarget } from './morph-compose';

/**
 * Bake a customized character into a fresh, static {@link Mesh}: compose the
 * weighted morph targets onto `basePositions` (the pristine base, not a live
 * preview that may already be morphed), copy the base's UVs and indices, and
 * recompute smooth normals for the new shape.
 *
 * The result is an ordinary mesh with no morph data — it flows through the
 * normal render (and, once rigged, skinning/animation) stack with zero runtime
 * morph cost. This is the edit-time character-creator "Bake": freeze the current
 * slider weights into a shippable mesh (ADR-0132).
 *
 * `baseMesh` supplies UVs + indices + topology (unchanged by morphing);
 * `basePositions` supplies the neutral positions the deltas add onto.
 */
export const bakeMorphedMesh = (
  baseMesh: Mesh,
  basePositions: Float32Array,
  contributions: readonly WeightedMorphTarget[],
  label?: string,
): Mesh => {
  const out = new Mesh(
    label !== undefined
      ? { label, primitiveTopology: baseMesh.primitiveTopology }
      : { primitiveTopology: baseMesh.primitiveTopology },
  );
  out.insertAttribute(MeshAttribute.POSITION, composeMorphedPositions(basePositions, contributions));
  const uv = baseMesh.getAttribute(MeshAttribute.UV_0);
  if (uv !== undefined) out.insertAttribute(MeshAttribute.UV_0, new Float32Array(uv.data as Float32Array));
  const idx = baseMesh.indices;
  if (idx !== undefined) {
    out.setIndices(idx.kind === 'u16' ? u16Indices(new Uint16Array(idx.data)) : u32Indices(new Uint32Array(idx.data)));
    if (out.primitiveTopology === 'triangle-list') out.computeSmoothNormals();
  }
  return out;
};
