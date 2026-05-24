import { Mesh } from '../mesh';
import { u32Indices } from '../indices';
import { MeshAttribute } from '../vertex-attribute';
import type { Meshable, MeshBuilder } from './meshable';

/**
 * 3D plane primitive — flat rectangle lying on the XZ plane (normal `(0, 1, 0)`),
 * centred at the origin.
 *
 * `halfSize` is `[width/2, depth/2]`. Subdivisions live on the builder.
 */
export class Plane3d implements Meshable<Plane3dMeshBuilder> {
  readonly halfSize: readonly [number, number];

  constructor(options?: { halfSize?: readonly [number, number] }) {
    this.halfSize = options?.halfSize ?? [0.5, 0.5];
  }

  mesh(): Plane3dMeshBuilder {
    return new Plane3dMeshBuilder(this);
  }
}

export class Plane3dMeshBuilder implements MeshBuilder {
  private subdivisionsValue = 0;

  constructor(private readonly plane: Plane3d) {}

  /** Number of internal divisions along each axis. Default 0 (one quad). */
  subdivisions(n: number): this {
    this.subdivisionsValue = n;
    return this;
  }

  build(): Mesh {
    const [hx, hz] = this.plane.halfSize;
    const n = this.subdivisionsValue + 1;
    const vertexCount = (n + 1) * (n + 1);
    const positions = new Float32Array(vertexCount * 3);
    const normals = new Float32Array(vertexCount * 3);
    const uvs = new Float32Array(vertexCount * 2);
    let p = 0;
    let nn = 0;
    let u = 0;
    for (let j = 0; j <= n; j++) {
      const vy = j / n;
      for (let i = 0; i <= n; i++) {
        const vx = i / n;
        positions[p++] = -hx + vx * 2 * hx;
        positions[p++] = 0;
        positions[p++] = -hz + vy * 2 * hz;
        normals[nn++] = 0;
        normals[nn++] = 1;
        normals[nn++] = 0;
        uvs[u++] = vx;
        uvs[u++] = vy;
      }
    }
    const indices: number[] = [];
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const a = j * (n + 1) + i;
        const b = a + (n + 1);
        indices.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
    return new Mesh({ label: 'Plane3d' })
      .insertAttribute(MeshAttribute.POSITION, positions)
      .insertAttribute(MeshAttribute.NORMAL, normals)
      .insertAttribute(MeshAttribute.UV_0, uvs)
      .setIndices(u32Indices(new Uint32Array(indices)));
  }
}
