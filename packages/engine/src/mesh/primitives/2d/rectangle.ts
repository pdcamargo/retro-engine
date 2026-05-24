import { Mesh } from '../../mesh';
import { u32Indices } from '../../indices';
import { MeshAttribute } from '../../vertex-attribute';
import type { Meshable, MeshBuilder } from '../meshable';

/**
 * 2D rectangle lying on the XY plane (normal `(0, 0, 1)`), centred at the
 * origin.
 */
export class Rectangle implements Meshable<RectangleMeshBuilder> {
  readonly halfSize: readonly [number, number];

  constructor(options?: { halfSize?: readonly [number, number] }) {
    this.halfSize = options?.halfSize ?? [0.5, 0.5];
  }

  mesh(): RectangleMeshBuilder {
    return new RectangleMeshBuilder(this);
  }
}

export class RectangleMeshBuilder implements MeshBuilder {
  constructor(private readonly rectangle: Rectangle) {}

  build(): Mesh {
    const [hx, hy] = this.rectangle.halfSize;
    const positions = new Float32Array([
      -hx, -hy, 0,
      hx, -hy, 0,
      hx, hy, 0,
      -hx, hy, 0,
    ]);
    const normals = new Float32Array([
      0, 0, 1,
      0, 0, 1,
      0, 0, 1,
      0, 0, 1,
    ]);
    const uvs = new Float32Array([
      0, 1,
      1, 1,
      1, 0,
      0, 0,
    ]);
    return new Mesh({ label: 'Rectangle' })
      .insertAttribute(MeshAttribute.POSITION, positions)
      .insertAttribute(MeshAttribute.NORMAL, normals)
      .insertAttribute(MeshAttribute.UV_0, uvs)
      .setIndices(u32Indices(new Uint32Array([0, 1, 2, 0, 2, 3])));
  }
}
