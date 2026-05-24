import { Mesh } from '../mesh';
import { u32Indices } from '../indices';
import { MeshAttribute } from '../vertex-attribute';
import type { Meshable, MeshBuilder } from './meshable';

/**
 * Sphere primitive. `radius` defaults to 0.5 (unit-diameter sphere).
 */
export class Sphere implements Meshable<SphereMeshBuilder> {
  readonly radius: number;

  constructor(options?: { radius?: number }) {
    this.radius = options?.radius ?? 0.5;
  }

  mesh(): SphereMeshBuilder {
    return new SphereMeshBuilder(this);
  }
}

/**
 * Triangulation choice for {@link SphereMeshBuilder}.
 *
 * - `ico` — icosphere: an icosahedron repeatedly subdivided. Default
 *   `subdivisions: 5`. Triangles are evenly distributed (no pole-clumping).
 * - `uv` — UV sphere: latitude / longitude grid. Default `sectors: 32`,
 *   `stacks: 18`. Cheaper UV mapping; degenerate at the poles.
 */
export type SphereKind =
  | { readonly kind: 'ico'; readonly subdivisions: number }
  | { readonly kind: 'uv'; readonly sectors: number; readonly stacks: number };

/**
 * Builder for {@link Sphere}. Default kind is `ico(5)` (matches Bevy).
 *
 * `.ico(n)` and `.uv(sectors, stacks)` switch + configure the triangulation.
 */
export class SphereMeshBuilder implements MeshBuilder {
  private kind: SphereKind = { kind: 'ico', subdivisions: 5 };

  constructor(private readonly sphere: Sphere) {}

  ico(subdivisions: number = 5): this {
    this.kind = { kind: 'ico', subdivisions };
    return this;
  }

  uv(sectors: number = 32, stacks: number = 18): this {
    this.kind = { kind: 'uv', sectors, stacks };
    return this;
  }

  build(): Mesh {
    if (this.kind.kind === 'uv') return this.buildUv(this.kind.sectors, this.kind.stacks);
    return this.buildIco(this.kind.subdivisions);
  }

  private buildUv(sectors: number, stacks: number): Mesh {
    const r = this.sphere.radius;
    const vertexCount = (stacks + 1) * (sectors + 1);
    const positions = new Float32Array(vertexCount * 3);
    const normals = new Float32Array(vertexCount * 3);
    const uvs = new Float32Array(vertexCount * 2);
    let p = 0;
    let n = 0;
    let u = 0;
    for (let i = 0; i <= stacks; i++) {
      const v = i / stacks;
      const phi = v * Math.PI; // 0 .. π
      const sp = Math.sin(phi);
      const cp = Math.cos(phi);
      for (let j = 0; j <= sectors; j++) {
        const uCoord = j / sectors;
        const theta = uCoord * Math.PI * 2; // 0 .. 2π
        const st = Math.sin(theta);
        const ct = Math.cos(theta);
        const nx = sp * ct;
        const ny = cp;
        const nz = sp * st;
        positions[p++] = nx * r;
        positions[p++] = ny * r;
        positions[p++] = nz * r;
        normals[n++] = nx;
        normals[n++] = ny;
        normals[n++] = nz;
        uvs[u++] = uCoord;
        uvs[u++] = 1 - v;
      }
    }
    const indices: number[] = [];
    for (let i = 0; i < stacks; i++) {
      for (let j = 0; j < sectors; j++) {
        const a = i * (sectors + 1) + j;
        const b = a + sectors + 1;
        indices.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
    return new Mesh({ label: 'Sphere(uv)' })
      .insertAttribute(MeshAttribute.POSITION, positions)
      .insertAttribute(MeshAttribute.NORMAL, normals)
      .insertAttribute(MeshAttribute.UV_0, uvs)
      .setIndices(u32Indices(new Uint32Array(indices)));
  }

  private buildIco(subdivisions: number): Mesh {
    // Start with a regular icosahedron.
    const t = (1 + Math.sqrt(5)) / 2;
    const verts: number[][] = [
      [-1, t, 0],
      [1, t, 0],
      [-1, -t, 0],
      [1, -t, 0],
      [0, -1, t],
      [0, 1, t],
      [0, -1, -t],
      [0, 1, -t],
      [t, 0, -1],
      [t, 0, 1],
      [-t, 0, -1],
      [-t, 0, 1],
    ];
    let faces: number[][] = [
      [0, 11, 5],
      [0, 5, 1],
      [0, 1, 7],
      [0, 7, 10],
      [0, 10, 11],
      [1, 5, 9],
      [5, 11, 4],
      [11, 10, 2],
      [10, 7, 6],
      [7, 1, 8],
      [3, 9, 4],
      [3, 4, 2],
      [3, 2, 6],
      [3, 6, 8],
      [3, 8, 9],
      [4, 9, 5],
      [2, 4, 11],
      [6, 2, 10],
      [8, 6, 7],
      [9, 8, 1],
    ];
    const cache = new Map<string, number>();
    const midpoint = (a: number, b: number): number => {
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      const cached = cache.get(key);
      if (cached !== undefined) return cached;
      const va = verts[a]!;
      const vb = verts[b]!;
      verts.push([(va[0]! + vb[0]!) / 2, (va[1]! + vb[1]!) / 2, (va[2]! + vb[2]!) / 2]);
      const idx = verts.length - 1;
      cache.set(key, idx);
      return idx;
    };
    for (let s = 0; s < subdivisions; s++) {
      const next: number[][] = [];
      for (const [a, b, c] of faces) {
        const ab = midpoint(a!, b!);
        const bc = midpoint(b!, c!);
        const ca = midpoint(c!, a!);
        next.push([a!, ab, ca], [b!, bc, ab], [c!, ca, bc], [ab, bc, ca]);
      }
      faces = next;
    }
    const r = this.sphere.radius;
    const positions = new Float32Array(verts.length * 3);
    const normals = new Float32Array(verts.length * 3);
    const uvs = new Float32Array(verts.length * 2);
    for (let i = 0; i < verts.length; i++) {
      const v = verts[i]!;
      const len = Math.hypot(v[0]!, v[1]!, v[2]!);
      const nx = v[0]! / len;
      const ny = v[1]! / len;
      const nz = v[2]! / len;
      positions[i * 3] = nx * r;
      positions[i * 3 + 1] = ny * r;
      positions[i * 3 + 2] = nz * r;
      normals[i * 3] = nx;
      normals[i * 3 + 1] = ny;
      normals[i * 3 + 2] = nz;
      uvs[i * 2] = Math.atan2(nz, nx) / (Math.PI * 2) + 0.5;
      uvs[i * 2 + 1] = ny * 0.5 + 0.5;
    }
    const indices = new Uint32Array(faces.length * 3);
    for (let i = 0; i < faces.length; i++) {
      const f = faces[i]!;
      indices[i * 3] = f[0]!;
      indices[i * 3 + 1] = f[1]!;
      indices[i * 3 + 2] = f[2]!;
    }
    return new Mesh({ label: 'Sphere(ico)' })
      .insertAttribute(MeshAttribute.POSITION, positions)
      .insertAttribute(MeshAttribute.NORMAL, normals)
      .insertAttribute(MeshAttribute.UV_0, uvs)
      .setIndices(u32Indices(indices));
  }
}
