import { Mesh } from '../mesh/mesh';
import { MeshAttribute } from '../mesh/vertex-attribute';
import type { SkinWeights } from './makehuman-weights';

/**
 * Attach skin weights to a mesh as the `JOINTS_0` / `WEIGHTS_0` vertex
 * attributes the GPU skinning path consumes.
 *
 * The {@link SkinWeights} arrays must be `vertexCount × 4` and aligned to the
 * mesh's vertex order — for a MakeHuman base mesh this holds when both were
 * built against the same `base.obj` vertex order. Mutating a mesh held in the
 * `Meshes` store should go through `Meshes.getMut` so the change re-uploads.
 */
export const applySkinWeights = (mesh: Mesh, weights: SkinWeights): void => {
  mesh.insertAttribute(MeshAttribute.JOINT_INDEX, weights.joints);
  mesh.insertAttribute(MeshAttribute.JOINT_WEIGHT, weights.weights);
};
