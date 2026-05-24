import { Mesh } from '../mesh';
import { u32Indices } from '../indices';
import { MeshAttribute } from '../vertex-attribute';
import type { Meshable, MeshBuilder } from './meshable';

/**
 * Regular tetrahedron with `circumradius` as the distance from the centroid to
 * a vertex.
 */
export class Tetrahedron implements Meshable<TetrahedronMeshBuilder> {
  readonly circumradius: number;

  constructor(options?: { circumradius?: number }) {
    this.circumradius = options?.circumradius ?? 0.5;
  }

  mesh(): TetrahedronMeshBuilder {
    return new TetrahedronMeshBuilder(this);
  }
}

export class TetrahedronMeshBuilder implements MeshBuilder {
  constructor(private readonly tetrahedron: Tetrahedron) {}

  build(): Mesh {
    const r = this.tetrahedron.circumradius;
    // Vertices of a regular tetrahedron inscribed in a unit cube, scaled to
    // place each vertex at distance `r` from the centroid.
    const a = 1 / Math.sqrt(3);
    const baseVerts: number[][] = [
      [a, a, a],
      [-a, -a, a],
      [-a, a, -a],
      [a, -a, -a],
    ];
    // Four faces, each duplicates its three vertices so face normals are flat.
    // Winding is CCW from outside (right-hand rule on the per-face cross
    // product gives the outward normal direction).
    const faces: number[][] = [
      [0, 2, 1],
      [0, 1, 3],
      [0, 3, 2],
      [1, 2, 3],
    ];
    const positions = new Float32Array(faces.length * 3 * 3);
    const normals = new Float32Array(faces.length * 3 * 3);
    const uvs = new Float32Array(faces.length * 3 * 2);
    const indices = new Uint32Array(faces.length * 3);
    let p = 0;
    let n = 0;
    let u = 0;
    for (let i = 0; i < faces.length; i++) {
      const [ia, ib, ic] = faces[i] as [number, number, number];
      const va = baseVerts[ia]!;
      const vb = baseVerts[ib]!;
      const vc = baseVerts[ic]!;
      const ex = vb[0]! - va[0]!,
        ey = vb[1]! - va[1]!,
        ez = vb[2]! - va[2]!;
      const fx = vc[0]! - va[0]!,
        fy = vc[1]! - va[1]!,
        fz = vc[2]! - va[2]!;
      const nx = ey * fz - ez * fy;
      const ny = ez * fx - ex * fz;
      const nz = ex * fy - ey * fx;
      const len = Math.hypot(nx, ny, nz) || 1;
      const ux = nx / len,
        uy = ny / len,
        uz = nz / len;
      for (const v of [va, vb, vc]) {
        positions[p++] = v[0]! * r;
        positions[p++] = v[1]! * r;
        positions[p++] = v[2]! * r;
        normals[n++] = ux;
        normals[n++] = uy;
        normals[n++] = uz;
      }
      uvs[u++] = 0.5;
      uvs[u++] = 1;
      uvs[u++] = 0;
      uvs[u++] = 0;
      uvs[u++] = 1;
      uvs[u++] = 0;
      indices[i * 3] = i * 3;
      indices[i * 3 + 1] = i * 3 + 1;
      indices[i * 3 + 2] = i * 3 + 2;
    }
    return new Mesh({ label: 'Tetrahedron' })
      .insertAttribute(MeshAttribute.POSITION, positions)
      .insertAttribute(MeshAttribute.NORMAL, normals)
      .insertAttribute(MeshAttribute.UV_0, uvs)
      .setIndices(u32Indices(indices));
  }
}
