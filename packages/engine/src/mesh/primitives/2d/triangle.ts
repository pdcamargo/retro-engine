import { Mesh } from '../../mesh';
import { u32Indices } from '../../indices';
import { MeshAttribute } from '../../vertex-attribute';
import type { Meshable, MeshBuilder } from '../meshable';

/**
 * 2D triangle defined by three corners on the XY plane (normal `(0, 0, 1)`).
 *
 * Defaults to a right-angled isoceles triangle with legs of length 1 and the
 * right-angle vertex at the origin.
 */
export class Triangle implements Meshable<TriangleMeshBuilder> {
  readonly a: readonly [number, number];
  readonly b: readonly [number, number];
  readonly c: readonly [number, number];

  constructor(options?: {
    a?: readonly [number, number];
    b?: readonly [number, number];
    c?: readonly [number, number];
  }) {
    this.a = options?.a ?? [0, 0];
    this.b = options?.b ?? [1, 0];
    this.c = options?.c ?? [0, 1];
  }

  mesh(): TriangleMeshBuilder {
    return new TriangleMeshBuilder(this);
  }
}

export class TriangleMeshBuilder implements MeshBuilder {
  constructor(private readonly triangle: Triangle) {}

  build(): Mesh {
    const { a, b, c } = this.triangle;
    const positions = new Float32Array([a[0], a[1], 0, b[0], b[1], 0, c[0], c[1], 0]);
    const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]);
    const uvs = new Float32Array([0, 0, 1, 0, 0, 1]);
    return new Mesh({ label: 'Triangle' })
      .insertAttribute(MeshAttribute.POSITION, positions)
      .insertAttribute(MeshAttribute.NORMAL, normals)
      .insertAttribute(MeshAttribute.UV_0, uvs)
      .setIndices(u32Indices(new Uint32Array([0, 1, 2])));
  }
}
