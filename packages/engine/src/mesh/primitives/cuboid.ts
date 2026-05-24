import { Mesh } from '../mesh';
import { u32Indices } from '../indices';
import { MeshAttribute } from '../vertex-attribute';
import type { Meshable, MeshBuilder } from './meshable';

/**
 * Rectangular box primitive. `halfSize` is the distance from the centre to a
 * face along each axis — a unit cube has `halfSize: [0.5, 0.5, 0.5]`.
 */
export class Cuboid implements Meshable<CuboidMeshBuilder> {
  readonly halfSize: readonly [number, number, number];

  constructor(options?: { halfSize?: readonly [number, number, number] }) {
    this.halfSize = options?.halfSize ?? [0.5, 0.5, 0.5];
  }

  mesh(): CuboidMeshBuilder {
    return new CuboidMeshBuilder(this);
  }
}

/**
 * Builder for {@link Cuboid}. Emits a 24-vertex, 36-index mesh (6 faces × 4
 * vertices, one face-normal per vertex so face shading is flat).
 */
export class CuboidMeshBuilder implements MeshBuilder {
  constructor(private readonly cuboid: Cuboid) {}

  build(): Mesh {
    const [hx, hy, hz] = this.cuboid.halfSize;
    // Each face: 4 vertices in CCW order from outside, with face normal + UV.
    // Faces: +X, -X, +Y, -Y, +Z, -Z.
    const positions = new Float32Array([
      // +X face
      hx, -hy, -hz, hx, hy, -hz, hx, hy, hz, hx, -hy, hz,
      // -X face
      -hx, -hy, hz, -hx, hy, hz, -hx, hy, -hz, -hx, -hy, -hz,
      // +Y face
      -hx, hy, -hz, -hx, hy, hz, hx, hy, hz, hx, hy, -hz,
      // -Y face
      -hx, -hy, hz, -hx, -hy, -hz, hx, -hy, -hz, hx, -hy, hz,
      // +Z face
      -hx, -hy, hz, hx, -hy, hz, hx, hy, hz, -hx, hy, hz,
      // -Z face
      hx, -hy, -hz, -hx, -hy, -hz, -hx, hy, -hz, hx, hy, -hz,
    ]);
    const normals = new Float32Array([
      // +X
      1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0,
      // -X
      -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0,
      // +Y
      0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0,
      // -Y
      0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0,
      // +Z
      0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1,
      // -Z
      0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1,
    ]);
    const uvs = new Float32Array([
      0, 1, 0, 0, 1, 0, 1, 1, // +X
      0, 1, 0, 0, 1, 0, 1, 1, // -X
      0, 1, 0, 0, 1, 0, 1, 1, // +Y
      0, 1, 0, 0, 1, 0, 1, 1, // -Y
      0, 1, 0, 0, 1, 0, 1, 1, // +Z
      0, 1, 0, 0, 1, 0, 1, 1, // -Z
    ]);
    const indices = new Uint32Array(36);
    for (let face = 0; face < 6; face++) {
      const base = face * 4;
      const i = face * 6;
      indices[i] = base;
      indices[i + 1] = base + 1;
      indices[i + 2] = base + 2;
      indices[i + 3] = base;
      indices[i + 4] = base + 2;
      indices[i + 5] = base + 3;
    }
    return new Mesh({ label: 'Cuboid' })
      .insertAttribute(MeshAttribute.POSITION, positions)
      .insertAttribute(MeshAttribute.NORMAL, normals)
      .insertAttribute(MeshAttribute.UV_0, uvs)
      .setIndices(u32Indices(indices));
  }
}
