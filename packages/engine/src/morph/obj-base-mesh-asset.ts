import type { AssetImporter } from '@retro-engine/assets';

import type { Mesh } from '../mesh/mesh';
import { parseObjBaseMesh } from './obj-base-mesh';

/**
 * Asset-kind tag for a Wavefront OBJ loaded as a vertex-order-preserving base
 * mesh. Distinct from the engine's native `.rmesh` (`Mesh`) kind: an `.obj` is a
 * source file, and it is loaded through {@link parseObjBaseMesh} (one mesh vertex
 * per OBJ `v` line) so a MakeHuman `.target` keyed by `v` index aligns with it.
 */
export const OBJ_MESH_ASSET_KIND = 'ObjMesh';

/**
 * Importer for an `.obj` source file: decode UTF-8 and parse into a {@link Mesh}
 * via the vertex-order loader. Produced meshes land in the shared `Meshes` store,
 * so a `Mesh3d` references them like any other mesh.
 *
 * This is the morph-aligned base loader (ADR-0131), not a general OBJ importer —
 * positions stay in file order and seam UVs collapse to one per vertex. A general
 * split-by-attribute OBJ import is deferred.
 */
export const createObjMeshImporter = (): AssetImporter<Mesh> => (bytes) =>
  parseObjBaseMesh(new TextDecoder().decode(bytes));
