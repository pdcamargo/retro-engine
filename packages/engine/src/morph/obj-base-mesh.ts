import { Mesh } from '../mesh/mesh';
import { MeshAttribute } from '../mesh/vertex-attribute';
import { u32Indices } from '../mesh/indices';

/**
 * Parse a Wavefront OBJ into a {@link Mesh} **preserving vertex (`v`) order** —
 * one mesh vertex per OBJ position line, in file order — so a sparse morph target
 * keyed by `v` index (a MakeHuman `.target`) aligns with the mesh's vertices.
 *
 * This is deliberately *not* a general OBJ importer. A general importer splits a
 * position into several GPU vertices wherever it carries different UVs or normals
 * across faces (the MakeHuman base has 21k UVs over 19k positions), which would
 * renumber the vertices and break that alignment. Here every face index collapses
 * back to its position index, so the mesh stays in `v` order at the cost of one
 * UV per position (the first seen at a seam) — fine for the character-creator base
 * preview, where morph alignment matters and seam UVs do not.
 *
 * Faces may be triangles or quads (MakeHuman uses quads); quads (and larger
 * polygons) are fan-triangulated. Normals are absent in the source, so smooth
 * vertex normals are computed. A trivial per-position UV is always emitted so the
 * mesh satisfies shaders that require a UV channel.
 *
 * @throws Error when the OBJ has no vertices, or a face references a position
 *   index out of range (corruption — the data is meant to be topology-locked).
 */
export const parseObjBaseMesh = (text: string): Mesh => {
  const positions: number[] = [];
  const uvs: number[] = []; // flat u,v pairs from `vt` lines
  const indices: number[] = [];

  const lines = text.split('\n');
  // First pass for positions/uvs so a face can resolve forward references; OBJ
  // declares them before faces in practice, but two passes cost nothing here.
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.startsWith('v ')) {
      const p = line.split(/\s+/);
      positions.push(parseFloat(p[1]!), parseFloat(p[2]!), parseFloat(p[3]!));
    } else if (line.startsWith('vt ')) {
      const p = line.split(/\s+/);
      uvs.push(parseFloat(p[1]!), parseFloat(p[2]!));
    }
  }

  const vertexCount = positions.length / 3;
  if (vertexCount === 0) throw new Error('parseObjBaseMesh: OBJ has no vertices');

  // One UV per position, first occurrence wins; -1 means "not yet assigned".
  const vertexUv = new Float32Array(vertexCount * 2);
  const uvAssigned = new Uint8Array(vertexCount);

  const faceVerts: number[] = []; // reused per face: 0-based position indices
  const faceUvs: number[] = []; // parallel vt indices (0-based) or -1
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.startsWith('f ')) continue;
    faceVerts.length = 0;
    faceUvs.length = 0;
    const tokens = line.split(/\s+/);
    for (let t = 1; t < tokens.length; t++) {
      const tok = tokens[t]!;
      if (tok.length === 0) continue;
      const slash = tok.indexOf('/');
      const vStr = slash === -1 ? tok : tok.slice(0, slash);
      const v = Number.parseInt(vStr, 10) - 1; // OBJ is 1-based
      if (!Number.isInteger(v) || v < 0 || v >= vertexCount) {
        throw new Error(`parseObjBaseMesh: face on line ${i + 1} references vertex ${v + 1} out of range`);
      }
      let vt = -1;
      if (slash !== -1) {
        const rest = tok.slice(slash + 1);
        const secondSlash = rest.indexOf('/');
        const vtStr = secondSlash === -1 ? rest : rest.slice(0, secondSlash);
        if (vtStr.length > 0) vt = Number.parseInt(vtStr, 10) - 1;
      }
      faceVerts.push(v);
      faceUvs.push(vt);
      if (uvAssigned[v] === 0 && vt >= 0 && vt * 2 + 1 < uvs.length) {
        vertexUv[v * 2] = uvs[vt * 2]!;
        vertexUv[v * 2 + 1] = uvs[vt * 2 + 1]!;
        uvAssigned[v] = 1;
      }
    }
    // Fan-triangulate: (0,1,2), (0,2,3), …
    for (let k = 2; k < faceVerts.length; k++) {
      indices.push(faceVerts[0]!, faceVerts[k - 1]!, faceVerts[k]!);
    }
  }

  const mesh = new Mesh({ label: 'obj-base-mesh' });
  mesh.insertAttribute(MeshAttribute.POSITION, Float32Array.from(positions));
  // Attribute order is load-bearing: the PBR shader binds POSITION/NORMAL/UV to
  // @location(0/1/2), and the vertex layout follows insertion order. Insert a
  // NORMAL placeholder before UV so the final order is POSITION, NORMAL, UV;
  // computeSmoothNormals overwrites it in place (insertAttribute preserves a key's
  // position on replace) rather than appending it after UV.
  mesh.insertAttribute(MeshAttribute.NORMAL, new Float32Array(positions.length));
  mesh.insertAttribute(MeshAttribute.UV_0, vertexUv);
  mesh.setIndices(u32Indices(Uint32Array.from(indices)));
  // Source carries no normals; smooth them from the triangulated topology.
  mesh.computeSmoothNormals();
  return mesh;
};
